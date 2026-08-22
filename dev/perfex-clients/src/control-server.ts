import { AccountRole, roleOrder, SocialIdType, type SocialId } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverClientPlugin, { getAccountClient } from '@hcengineering/server-client'
import { type ChildProcess, fork } from 'node:child_process'
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { readSyncConfig, type SyncConfig } from './sync'
import { CONTROL_STAGES, isControlStage, type ControlStage } from './sync-control'

const RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAX_BODY_BYTES = 1024 * 1024

export type MigrationStepStatus =
  | 'pending'
  | 'running'
  | 'stopping'
  | 'cancelled'
  | 'failed'
  | 'succeeded'

export type MigrationRunStatus = 'waiting_confirmation' | MigrationStepStatus

export interface MigrationRunStep {
  id: string
  environment: string
  workspace: string
  stage: ControlStage
  status: MigrationStepStatus
  startedAt?: string
  finishedAt?: string
  lastMessage?: string
  error?: string
}

export interface MigrationRun {
  id: string
  createdAt: string
  createdBy: string
  dryRun: boolean
  status: MigrationRunStatus
  lastSequence: number
  steps: MigrationRunStep[]
}

export interface MigrationLogEvent {
  sequence: number
  timestamp: string
  level: 'info' | 'warn' | 'error'
  environment: string
  workspace: string
  stage: ControlStage
  table?: string
  phase?: 'start' | 'finish' | 'error'
  message: string
}

interface CreateRunInput {
  environments?: string[]
  stages?: string[]
  dryRun?: boolean
}

interface ActiveStep {
  runId: string
  stepId: string
  child: ChildProcess
  stopRequested: boolean
  spawnError?: string
}

interface WorkerMessage {
  marker: 'perfex-migration'
  level: 'info' | 'warn' | 'error'
  message: string
  table?: string
  phase?: 'start' | 'finish' | 'error'
}

class HttpError extends Error {
  constructor (readonly status: number, message: string) {
    super(message)
  }
}

/** Oculta secretos reconocibles antes de que una línea salga del proceso. */
export function redactLog (value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, '$1[REDACTED]')
    .replace(/((?:token|password|secret|passwd|pwd)["'\s:=]+)[^\s,"'}]+/gi, '$1[REDACTED]')
}

/** Indica si el rol puede operar herramientas reservadas a mantenedores. */
export function hasMaintainerRole (role: AccountRole): boolean {
  return roleOrder[role] >= roleOrder[AccountRole.Maintainer]
}

/** Devuelve un email verificado presente en la lista de operadores autorizados. */
export function authorizedEmail (socialIds: SocialId[], allowedEmails: Set<string>): string | undefined {
  return socialIds.find(
    (socialId) =>
      socialId.type === SocialIdType.EMAIL &&
      socialId.verifiedOn !== undefined &&
      allowedEmails.has(socialId.value.trim().toLowerCase())
  )?.value.toLowerCase()
}

/** Construye la matriz ordenada de workspace por etapa solicitada. */
export function createRunPlan (
  config: SyncConfig,
  input: CreateRunInput,
  createdBy: string,
  now = new Date()
): MigrationRun {
  if (input.dryRun !== undefined && typeof input.dryRun !== 'boolean') {
    throw new HttpError(400, 'dryRun debe ser booleano')
  }
  if (input.environments !== undefined && (!Array.isArray(input.environments) || input.environments.some((value) => typeof value !== 'string'))) {
    throw new HttpError(400, 'environments debe ser una lista de strings')
  }
  if (input.stages !== undefined && (!Array.isArray(input.stages) || input.stages.some((value) => typeof value !== 'string'))) {
    throw new HttpError(400, 'stages debe ser una lista de strings')
  }
  const knownEnvironments = new Set(config.workspaces.map(({ env }) => env))
  const requestedEnvironments = input.environments ?? [...knownEnvironments]
  const invalidEnvironments = requestedEnvironments.filter((environment) => !knownEnvironments.has(environment))
  if (invalidEnvironments.length > 0) throw new HttpError(400, `Workspaces inválidos: ${invalidEnvironments.join(', ')}`)

  const requestedStages = input.stages ?? CONTROL_STAGES.map(({ id }) => id)
  const invalidStages = requestedStages.filter((stage) => !isControlStage(stage))
  if (invalidStages.length > 0) throw new HttpError(400, `Etapas inválidas: ${invalidStages.join(', ')}`)

  const environments = new Set(requestedEnvironments)
  const stages = new Set(requestedStages)
  const steps = config.workspaces
    .filter(({ env }) => environments.has(env))
    .flatMap((workspace) =>
      CONTROL_STAGES.filter(({ id }) => stages.has(id)).map(({ id }) => ({
        id: `${workspace.env}:${id}`,
        environment: workspace.env,
        workspace: workspace.workspace,
        stage: id,
        status: 'pending' as const
      }))
    )
  if (steps.length === 0) throw new HttpError(400, 'La corrida debe incluir al menos una etapa')

  return {
    id: randomUUID(),
    createdAt: now.toISOString(),
    createdBy,
    dryRun: input.dryRun === true,
    status: 'waiting_confirmation',
    lastSequence: 0,
    steps
  }
}

export class MigrationControlService {
  private readonly config: SyncConfig
  private readonly runs = new Map<string, MigrationRun>()
  private readonly eventCache = new Map<string, MigrationLogEvent[]>()
  // ponytail: lock global en memoria; usar un lease compartido solo si este servicio se replica.
  private active?: ActiveStep

  constructor (
    private readonly configPath: string,
    private readonly logDir: string,
    private readonly entryFile: string
  ) {
    this.config = readSyncConfig(configPath)
    mkdirSync(logDir, { recursive: true })
    this.loadRuns()
    this.cleanup()
  }

  /** Expone configuración operable sin incluir secretos ni tokens. */
  getPlan (): Record<string, unknown> {
    return {
      workspaces: this.config.workspaces.map(({ env, workspace }) => ({ env, workspace })),
      stages: CONTROL_STAGES,
      active: this.active === undefined ? null : { runId: this.active.runId, stepId: this.active.stepId }
    }
  }

  /** Lista corridas persistidas desde la más reciente. */
  listRuns (): MigrationRun[] {
    return [...this.runs.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  }

  /** Obtiene una corrida o falla con respuesta HTTP 404. */
  getRun (runId: string): MigrationRun {
    const run = this.runs.get(runId)
    if (run === undefined) throw new HttpError(404, 'Corrida no encontrada')
    return run
  }

  /** Crea y persiste una corrida pendiente de confirmación. */
  createRun (input: CreateRunInput, createdBy: string): MigrationRun {
    const run = createRunPlan(this.config, input, createdBy)
    this.runs.set(run.id, run)
    writeFileSync(this.logPath(run.id), '', { flag: 'a' })
    this.saveRun(run)
    return run
  }

  /** Inicia una sola etapa reintentable en un worker aislado. */
  startStep (runId: string, stepId: string): MigrationRun {
    if (this.active !== undefined) throw new HttpError(409, 'Ya hay una etapa en ejecución')
    const run = this.getRun(runId)
    const step = run.steps.find(({ id }) => id === stepId)
    if (step === undefined) throw new HttpError(404, 'Etapa no encontrada')
    if (!['pending', 'failed', 'cancelled'].includes(step.status)) {
      throw new HttpError(409, `La etapa está ${step.status}`)
    }

    step.status = 'running'
    step.startedAt = new Date().toISOString()
    step.finishedAt = undefined
    step.error = undefined
    step.lastMessage = 'Iniciando proceso aislado'
    run.status = 'running'
    this.saveRun(run)
    this.spawnStep(run, step)
    return run
  }

  /** Solicita detención cooperativa del worker activo de una corrida. */
  stopRun (runId: string): MigrationRun {
    const run = this.getRun(runId)
    if (this.active?.runId !== runId) throw new HttpError(409, 'La corrida no tiene una etapa activa')
    const step = run.steps.find(({ id }) => id === this.active?.stepId)
    if (step === undefined) throw new HttpError(409, 'No se encontró la etapa activa')

    this.active.stopRequested = true
    step.status = 'stopping'
    step.lastMessage = 'Detención solicitada; esperando el ítem activo'
    run.status = 'stopping'
    this.appendEvent(run, step, { level: 'warn', message: step.lastMessage })
    this.saveRun(run)
    this.active.child.kill('SIGTERM')
    return run
  }

  /** Devuelve eventos posteriores a una secuencia para polling incremental. */
  getEvents (runId: string, after: number): MigrationLogEvent[] {
    this.getRun(runId)
    let events = this.eventCache.get(runId)
    if (events === undefined) {
      const path = this.logPath(runId)
      events = existsSync(path)
        ? readFileSync(path, 'utf8')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as MigrationLogEvent)
        : []
      this.eventCache.set(runId, events)
    }
    return events.filter(({ sequence }) => sequence > after)
  }

  /** Resuelve el archivo JSONL de una corrida existente. */
  getLogPath (runId: string): string {
    this.getRun(runId)
    return this.logPath(runId)
  }

  /** Elimina corridas y logs vencidos por la retención configurada. */
  cleanup (now = Date.now()): void {
    const cutoff = now - RETENTION_MS
    for (const run of this.runs.values()) {
      if (new Date(run.createdAt).getTime() >= cutoff || this.active?.runId === run.id) continue
      this.runs.delete(run.id)
      this.eventCache.delete(run.id)
      for (const path of [this.runPath(run.id), this.logPath(run.id)]) {
        if (existsSync(path)) unlinkSync(path)
      }
    }
  }

  /** Recupera corridas y vuelve reintentables las interrumpidas por reinicio. */
  private loadRuns (): void {
    for (const file of readdirSync(this.logDir).filter((name) => /^[0-9a-f-]{36}\.json$/.test(name))) {
      const run = JSON.parse(readFileSync(join(this.logDir, file), 'utf8')) as MigrationRun
      let interrupted = false
      for (const step of run.steps) {
        if (step.status !== 'running' && step.status !== 'stopping') continue
        step.status = 'failed'
        step.finishedAt = new Date().toISOString()
        step.error = 'El servicio se reinició durante esta etapa; puede reintentarse'
        step.lastMessage = step.error
        interrupted = true
      }
      if (interrupted) {
        run.status = 'failed'
        this.saveRun(run)
      }
      this.runs.set(run.id, run)
    }
  }

  /** Ejecuta una etapa en proceso hijo y consolida su resultado persistente. */
  private spawnStep (run: MigrationRun, step: MigrationRunStep): void {
    const args = [
      'sync-step',
      '--config',
      this.configPath,
      '--env',
      step.environment,
      '--stage',
      step.stage,
      ...(run.dryRun ? ['--dry-run'] : [])
    ]
    const child = fork(this.entryFile, args, { silent: true, env: process.env })
    const active: ActiveStep = { runId: run.id, stepId: step.id, child, stopRequested: false }
    this.active = active

    if (child.stdout !== null) {
      createInterface({ input: child.stdout }).on('line', (line) => { this.captureLine(run, step, line, 'info') })
    }
    if (child.stderr !== null) {
      createInterface({ input: child.stderr }).on('line', (line) => { this.captureLine(run, step, line, 'error') })
    }
    child.on('error', (err) => {
      active.spawnError = err.message
      this.appendEvent(run, step, { level: 'error', message: err.stack ?? err.message })
    })
    child.on('close', (code, signal) => {
      if (this.active !== active) return
      this.active = undefined
      step.finishedAt = new Date().toISOString()
      if (active.stopRequested) {
        step.status = 'cancelled'
        step.lastMessage = 'Etapa detenida; puede reintentarse'
        run.status = 'cancelled'
      } else if (code === 0 && active.spawnError === undefined) {
        step.status = 'succeeded'
        step.lastMessage = 'Etapa completada'
        run.status = run.steps.every(({ status }) => status === 'succeeded') ? 'succeeded' : 'waiting_confirmation'
      } else {
        step.status = 'failed'
        step.error = active.spawnError ?? `El worker terminó con código ${code ?? 'desconocido'}${signal === null ? '' : ` (${signal})`}`
        step.lastMessage = step.error
        run.status = 'failed'
      }
      this.appendEvent(run, step, {
        level: step.status === 'succeeded' ? 'info' : step.status === 'cancelled' ? 'warn' : 'error',
        message: step.lastMessage
      })
      this.saveRun(run)
    })
  }

  /** Normaliza una línea del worker como evento estructurado y redactado. */
  private captureLine (
    run: MigrationRun,
    step: MigrationRunStep,
    line: string,
    fallbackLevel: MigrationLogEvent['level']
  ): void {
    let event: Omit<MigrationLogEvent, 'sequence' | 'timestamp' | 'environment' | 'workspace' | 'stage'>
    try {
      const parsed = JSON.parse(line) as Partial<WorkerMessage>
      event = parsed.marker === 'perfex-migration' && parsed.message !== undefined
        ? {
            level: parsed.level ?? fallbackLevel,
            message: parsed.message,
            table: parsed.table,
            phase: parsed.phase
          }
        : { level: fallbackLevel, message: line }
    } catch {
      event = { level: fallbackLevel, message: line }
    }
    step.lastMessage = redactLog(event.message)
    this.appendEvent(run, step, event)
    this.saveRun(run)
  }

  /** Persiste un evento monotónico y actualiza su caché si está cargada. */
  private appendEvent (
    run: MigrationRun,
    step: MigrationRunStep,
    event: Omit<MigrationLogEvent, 'sequence' | 'timestamp' | 'environment' | 'workspace' | 'stage'>
  ): void {
    const saved: MigrationLogEvent = {
      ...event,
      message: redactLog(event.message),
      sequence: ++run.lastSequence,
      timestamp: new Date().toISOString(),
      environment: step.environment,
      workspace: step.workspace,
      stage: step.stage
    }
    appendFileSync(this.logPath(run.id), `${JSON.stringify(saved)}\n`)
    this.eventCache.get(run.id)?.push(saved)
  }

  /** Guarda metadatos de corrida mediante reemplazo atómico. */
  private saveRun (run: MigrationRun): void {
    const path = this.runPath(run.id)
    const temporary = `${path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(run, null, 2)}\n`)
    renameSync(temporary, path)
  }

  private runPath (runId: string): string {
    return join(this.logDir, `${runId}.json`)
  }

  private logPath (runId: string): string {
    return join(this.logDir, `${runId}.jsonl`)
  }
}

/** Inicia la API operacional; todos los endpoints salvo health exigen rol y allowlist. */
export async function startControlServer (): Promise<void> {
  const configPath = requiredEnv('PERFEX_SYNC_CONFIG')
  const accountsUrl = requiredEnv('ACCOUNTS_URL')
  const allowedEmails = new Set(
    requiredEnv('PERFEX_MIGRATION_ALLOWED_EMAILS').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean)
  )
  const port = Number(process.env.PERFEX_MIGRATION_PORT ?? 4080)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PERFEX_MIGRATION_PORT inválido')
  const logDir = process.env.PERFEX_MIGRATION_LOG_DIR ?? '/var/lib/perfex-migration'
  setMetadata(serverClientPlugin.metadata.Endpoint, accountsUrl)

  const control = new MigrationControlService(configPath, logDir, process.argv[1])
  const cleanupTimer = setInterval(() => { control.cleanup() }, 24 * 60 * 60 * 1000)
  cleanupTimer.unref()

  const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'GET' && url.pathname === '/health') { writeJson(res, 200, { ok: true }); return }
      const email = await authorize(req, allowedEmails)

      if (req.method === 'GET' && url.pathname === '/api/plan') { writeJson(res, 200, control.getPlan()); return }
      if (req.method === 'GET' && url.pathname === '/api/runs') { writeJson(res, 200, control.listRuns()); return }
      if (req.method === 'POST' && url.pathname === '/api/runs') {
        writeJson(res, 201, control.createRun(await readJson(req), email)); return
      }

      const runMatch = /^\/api\/runs\/([0-9a-f-]+)$/.exec(url.pathname)
      if (req.method === 'GET' && runMatch !== null) { writeJson(res, 200, control.getRun(runMatch[1])); return }

      const eventsMatch = /^\/api\/runs\/([0-9a-f-]+)\/events$/.exec(url.pathname)
      if (req.method === 'GET' && eventsMatch !== null) {
        const after = Number(url.searchParams.get('after') ?? 0)
        writeJson(res, 200, control.getEvents(eventsMatch[1], Number.isFinite(after) ? after : 0)); return
      }

      const logMatch = /^\/api\/runs\/([0-9a-f-]+)\/log$/.exec(url.pathname)
      if (req.method === 'GET' && logMatch !== null) {
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Content-Disposition': `attachment; filename="perfex-migration-${logMatch[1]}.jsonl"`
        })
        createReadStream(control.getLogPath(logMatch[1])).pipe(res)
        return
      }

      const stopMatch = /^\/api\/runs\/([0-9a-f-]+)\/stop$/.exec(url.pathname)
      if (req.method === 'POST' && stopMatch !== null) { writeJson(res, 202, control.stopRun(stopMatch[1])); return }

      const stepMatch = /^\/api\/runs\/([0-9a-f-]+)\/steps\/([^/]+)\/(?:start|retry)$/.exec(url.pathname)
      if (req.method === 'POST' && stepMatch !== null) {
        writeJson(res, 202, control.startStep(stepMatch[1], decodeURIComponent(stepMatch[2]))); return
      }

      throw new HttpError(404, 'Ruta no encontrada')
    } catch (err: unknown) {
      const status = err instanceof HttpError ? err.status : 500
      writeJson(res, status, { error: err instanceof Error ? err.message : String(err) })
    }
  }
  const server = createServer((req, res) => {
    void handleRequest(req, res)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => { resolve() })
  })
}

/** Autoriza bearer token con rol Maintainer y email verificado en allowlist. */
async function authorize (req: IncomingMessage, allowedEmails: Set<string>): Promise<string> {
  const authorization = req.headers.authorization ?? ''
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Falta autenticación')
  const token = authorization.slice('Bearer '.length)
  const accountClient = getAccountClient(token)
  const info = await accountClient.getLoginInfoByToken()
  if (info === null || !('role' in info)) throw new HttpError(401, 'Token de workspace inválido')
  if (!hasMaintainerRole(info.role)) throw new HttpError(403, 'Se requiere Maintainer')

  const email = authorizedEmail(await accountClient.getSocialIds(false), allowedEmails)
  if (email === undefined) throw new HttpError(403, 'Cuenta no autorizada para migraciones')
  return email
}

/** Lee y valida un cuerpo JSON acotado. */
async function readJson (req: IncomingMessage): Promise<CreateRunInput> {
  let body = ''
  for await (const chunk of req) {
    body += chunk.toString()
    if (body.length > MAX_BODY_BYTES) throw new HttpError(413, 'Solicitud demasiado grande')
  }
  if (body === '') return {}
  try {
    return JSON.parse(body) as CreateRunInput
  } catch {
    throw new HttpError(400, 'JSON inválido')
  }
}

/** Escribe una respuesta JSON no cacheable si aún no comenzó la respuesta. */
function writeJson (res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

/** Obtiene una variable obligatoria sin aceptar valores vacíos. */
function requiredEnv (name: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') throw new Error(`Falta la variable ${name}`)
  return value
}
