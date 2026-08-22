import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountRole, SocialIdType, type SocialId } from '@hcengineering/core'

import {
  authorizedEmail,
  createCleanupPlan,
  createRunPlan,
  hasMaintainerRole,
  MigrationControlService,
  redactLog,
  resolveWorkerFailure,
  type MigrationRun
} from '../control-server'
import type { SyncConfig } from '../sync'

const config: SyncConfig = {
  front: 'https://ops.example',
  permisosCsv: '/config/permisos.csv',
  workspaces: ['wiwo', 'palta', 'mgc', 'sin-clasificar'].map((env) => ({
    env,
    workspace: env,
    tokenEnv: `HULY_TOKEN_${env.toUpperCase()}`,
    owners: ['owner@example.com']
  }))
}

describe('centro de migración', () => {
  it('crea una matriz en orden y permite acotarla', () => {
    const run = createRunPlan(config, { environments: ['palta'], stages: ['preflight', 'clientes'], dryRun: true }, 'j@wiwo.me')

    expect(run.dryRun).toBe(true)
    expect(run.steps.map(({ id }) => id)).toEqual(['palta:preflight', 'palta:clientes'])
  })

  it('rechaza workspaces y etapas que no estén configurados', () => {
    expect(() => createRunPlan(config, { environments: ['otro'] }, 'j@wiwo.me')).toThrow('Workspaces inválidos')
    expect(() => createRunPlan(config, { stages: ['sql-libre'] }, 'j@wiwo.me')).toThrow('Etapas inválidas')
  })

  it('rechaza tipos inválidos recibidos por la API', () => {
    expect(() => createRunPlan(config, { environments: 'wiwo' } as unknown as { environments: string[] }, 'j@wiwo.me')).toThrow('lista de strings')
    expect(() => createRunPlan(config, { dryRun: 'sí' } as unknown as { dryRun: boolean }, 'j@wiwo.me')).toThrow('booleano')
  })

  it('crea una vista previa de limpieza para un solo workspace', () => {
    const run = createCleanupPlan(config, 'mgc', 'j@wiwo.me', 'cleanup-preview')

    expect(run.kind).toBe('cleanup-preview')
    expect(run.dryRun).toBe(true)
    expect(run.steps).toEqual([expect.objectContaining({ id: 'mgc:cleanup', workspace: 'mgc', stage: 'cleanup' })])
  })

  it('no permite una limpieza real sin conteos confirmados', () => {
    expect(() => createCleanupPlan(config, 'mgc', 'j@wiwo.me', 'cleanup-execute')).toThrow(
      'requiere una vista previa válida'
    )
  })

  it('redacta credenciales antes de persistir logs', () => {
    expect(redactLog('Authorization: Bearer abc.def token=secreto password:clave')).toBe(
      'Authorization: Bearer [REDACTED] token=[REDACTED] password:[REDACTED]'
    )
  })

  it('conserva el error real del worker en vez de reemplazarlo por el código de salida', () => {
    const failure = resolveWorkerFailure(
      'Error: Access denied for user perfex\n    at Connection.query',
      undefined,
      1,
      null
    )

    expect(failure.summary).toBe('Access denied for user perfex')
    expect(failure.error).toContain('Connection.query')
    expect(failure.error).not.toContain('código 1')
  })

  it('exige Maintainer y un correo verificado de la allowlist', () => {
    const allowed = new Set(['j@wiwo.me'])
    const socialIds = [
      { type: SocialIdType.EMAIL, value: 'otro@wiwo.me', verifiedOn: 1 },
      { type: SocialIdType.EMAIL, value: 'J@WIWO.ME', verifiedOn: 1 }
    ] as SocialId[]

    expect(hasMaintainerRole(AccountRole.User)).toBe(false)
    expect(hasMaintainerRole(AccountRole.Maintainer)).toBe(true)
    expect(hasMaintainerRole(AccountRole.Owner)).toBe(true)
    expect(authorizedEmail(socialIds, allowed)).toBe('j@wiwo.me')
    expect(authorizedEmail([{ ...socialIds[1], verifiedOn: undefined }], allowed)).toBeUndefined()
  })

  it('marca como fallida una etapa interrumpida por reinicio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perfex-control-'))
    const configPath = join(dir, 'sync.json')
    writeFileSync(configPath, JSON.stringify(config))
    const run: MigrationRun = {
      id: '10000000-0000-0000-0000-000000000000',
      createdAt: new Date().toISOString(),
      createdBy: 'j@wiwo.me',
      dryRun: false,
      status: 'running',
      lastSequence: 0,
      steps: [{
        id: 'wiwo:clientes',
        environment: 'wiwo',
        workspace: 'wiwo',
        stage: 'clientes',
        status: 'running'
      }]
    }
    writeFileSync(join(dir, `${run.id}.json`), JSON.stringify(run))

    const service = new MigrationControlService(configPath, dir, '/tmp/worker.js')

    const recovered = JSON.parse(readFileSync(join(dir, `${run.id}.json`), 'utf8')) as MigrationRun
    expect(service.listRuns()).toHaveLength(1)
    expect(recovered.status).toBe('failed')
    expect(recovered.steps[0].status).toBe('failed')
    expect(recovered.steps[0].error).toContain('reinició')
    rmSync(dir, { recursive: true })
  })

  it('exige el nombre exacto del workspace antes del borrado', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perfex-control-'))
    const configPath = join(dir, 'sync.json')
    writeFileSync(configPath, JSON.stringify(config))
    const preview: MigrationRun = {
      id: '20000000-0000-0000-0000-000000000000',
      createdAt: new Date().toISOString(),
      createdBy: 'j@wiwo.me',
      dryRun: true,
      kind: 'cleanup-preview',
      status: 'succeeded',
      lastSequence: 0,
      steps: [
        {
          id: 'mgc:cleanup',
          environment: 'mgc',
          workspace: 'mgc',
          stage: 'cleanup',
          status: 'succeeded',
          result: {
            projects: 1,
            issues: 1,
            organizations: 1,
            people: 1,
            attachments: 1,
            tags: 1,
            preservedPeople: 2
          }
        }
      ]
    }
    writeFileSync(join(dir, `${preview.id}.json`), JSON.stringify(preview))

    const service = new MigrationControlService(configPath, dir, '/tmp/worker.js')

    expect(() => service.createCleanupExecution(preview.id, { confirmation: 'MGC' }, 'j@wiwo.me')).toThrow(
      'Escribe exactamente "mgc"'
    )
    expect(service.listRuns()).toHaveLength(0)
    expect(service.listCleanups()).toHaveLength(1)
    rmSync(dir, { recursive: true })
  })
})
