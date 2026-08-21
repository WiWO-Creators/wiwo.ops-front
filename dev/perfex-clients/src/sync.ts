//
// Orquestación de la reconciliación completa del dump de Perfex.
//
import contact from '@hcengineering/contact'
import core, { type Ref, type TxOperations } from '@hcengineering/core'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import { readFileSync } from 'node:fs'

import { belongsToEnvironment, ENVIRONMENTS, type Environment } from './environments'
import { normalizarNombre } from './existente'

const ARCHIVE_BATCH = 25

export interface SyncWorkspace {
  env: string
  workspace: string
  tokenEnv: string
  owners: string[]
}

export interface SyncConfig {
  front: string
  transactor?: string
  dirAdjuntos?: string
  mapaDuplicados?: string
  permisosCsv: string
  workspaces: SyncWorkspace[]
}

export interface MapaDuplicados {
  organizaciones?: Record<string, string>
  personas?: Record<string, string>
  proyectos?: Record<string, string>
  tareas?: Record<string, string>
}

export interface Duplicado {
  tipo: keyof MapaDuplicados
  clave: string
  ids: string[]
}

export interface Archivado {
  proyectos: number
  tareas: number
}

/** Lee y valida destinos locales, sin admitir secretos dentro del archivo. */
export function readSyncConfig (path: string): SyncConfig {
  const config = JSON.parse(readFileSync(path, 'utf8')) as Partial<SyncConfig>
  if ('token' in config) throw new Error('El manifiesto no puede contener tokens; usá tokenEnv')
  if (typeof config.front !== 'string' || config.front === '') throw new Error('El manifiesto requiere "front"')
  if (typeof config.permisosCsv !== 'string' || config.permisosCsv === '') {
    throw new Error('El manifiesto requiere "permisosCsv" para M08')
  }
  if (!Array.isArray(config.workspaces)) throw new Error('El manifiesto requiere "workspaces"')

  const expected = new Set(ENVIRONMENTS.map((environment) => environment.id))
  const seen = new Set<string>()
  for (const workspace of config.workspaces) {
    if (typeof workspace?.env !== 'string' || !expected.has(workspace.env)) {
      throw new Error(`Ambiente inválido en el manifiesto: ${workspace?.env ?? 'ausente'}`)
    }
    if (seen.has(workspace.env)) throw new Error(`Ambiente repetido en el manifiesto: ${workspace.env}`)
    if (typeof workspace.workspace !== 'string' || workspace.workspace === '') {
      throw new Error(`Falta "workspace" para ${workspace.env}`)
    }
    if (typeof workspace.tokenEnv !== 'string' || workspace.tokenEnv === '') {
      throw new Error(`Falta "tokenEnv" para ${workspace.env}`)
    }
    if (
      !Array.isArray(workspace.owners) ||
      workspace.owners.length === 0 ||
      workspace.owners.some((owner) => typeof owner !== 'string' || owner === '')
    ) {
      throw new Error(`Falta "owners" válidos para ${workspace.env}`)
    }
    if ('token' in workspace) throw new Error(`El manifiesto no puede contener tokens para ${workspace.env}`)
    seen.add(workspace.env)
  }
  if (seen.size !== expected.size) {
    throw new Error(`El manifiesto debe declarar: ${ENVIRONMENTS.map((environment) => environment.id).join(', ')}`)
  }
  return config as SyncConfig
}

/** Lee el mapa de registros canónicos para duplicados ya existentes en Huly. */
export function readDuplicateMap (path: string | undefined): MapaDuplicados {
  return path === undefined || path === '' ? {} : JSON.parse(readFileSync(path, 'utf8')) as MapaDuplicados
}

/** Devuelve los elementos de `actuales` que no existen en el snapshot de Perfex. */
export function idsParaArchivar (actuales: Array<number | undefined>, presentes: Set<number>): number[] {
  return actuales.filter((id): id is number => id !== undefined && !presentes.has(id))
}

/** Detecta claves repetidas y exige que el mapa elija uno de sus ids como canónico. */
export function duplicadosSinResolver (duplicados: Duplicado[], mapa: MapaDuplicados): Duplicado[] {
  return duplicados.filter((duplicado) => {
    if (duplicado.tipo === 'proyectos' || duplicado.tipo === 'tareas') return true
    const canonic = mapa[duplicado.tipo]?.[duplicado.clave]
    return canonic === undefined || !duplicado.ids.includes(canonic)
  })
}

/** Revisa duplicados de las anclas que usa la migración antes de escribir. */
export async function buscarDuplicados (client: TxOperations): Promise<Duplicado[]> {
  const [organizations, channels, projects, issues] = await Promise.all([
    client.findAll(contact.class.Organization, {}, { projection: { _id: 1, name: 1 } }),
    client.findAll(
      contact.class.Channel,
      { provider: contact.channelProvider.Email },
      { projection: { _id: 1, value: 1, attachedTo: 1 } }
    ),
    client.findAll(tracker.class.Project, {}, { projection: { _id: 1, perfexId: 1 } }),
    client.findAll<any>(tracker.class.Issue as any, {}, { projection: { _id: 1, perfexId: 1 } })
  ])

  return [
    ...agruparDuplicados('organizaciones', organizations.map((doc) => [normalizarNombre(doc.name), doc._id] as const)),
    ...agruparDuplicados('personas', channels.map((doc) => [doc.value.trim().toLowerCase(), doc.attachedTo] as const)),
    ...agruparDuplicados('proyectos', projects.map((doc) => [String(doc.perfexId), doc._id] as const), true),
    ...agruparDuplicados('tareas', issues.map((doc) => [String(doc.perfexId), doc._id] as const), true)
  ]
}

/** Agrupa anclas repetidas y conserva sólo las que tienen más de un documento destino. */
function agruparDuplicados (
  tipo: keyof MapaDuplicados,
  entries: Array<readonly [string, string | undefined]>,
  omitirIndefinidos = false
): Duplicado[] {
  const grouped = new Map<string, string[]>()
  for (const [key, id] of entries) {
    if (omitirIndefinidos && key === 'undefined') continue
    if (key === '' || id === undefined) continue
    const ids = grouped.get(key) ?? []
    ids.push(id as string)
    grouped.set(key, ids)
  }
  return [...grouped].filter(([, ids]) => ids.length > 1).map(([clave, ids]) => ({ tipo, clave, ids }))
}

/** Archiva documentos migrados que no pertenecen al snapshot actual. */
export async function archivarAusentes (
  client: TxOperations,
  projectIds: Set<number>,
  taskIds: Set<number>,
  dryRun: boolean
): Promise<Archivado> {
  const [projects, issues] = await Promise.all([
    client.findAll(tracker.class.Project, {}, { projection: { _id: 1, perfexId: 1 } }),
    client.findAll<any>(tracker.class.Issue as any, {}, { projection: { _id: 1, perfexId: 1, space: 1 } })
  ])
  const staleProjects = projects.filter((project) => idsParaArchivar([project.perfexId], projectIds).length > 0)
  const staleIssues = issues.filter((issue) => idsParaArchivar([issue.perfexId], taskIds).length > 0)
  if (!dryRun) {
    await actualizarEnLotes(staleProjects, async (project) => {
      await client.updateDoc(tracker.class.Project, core.space.Space, project._id as Ref<Project>, { archived: true })
    })
    await actualizarEnLotes(staleIssues, async (issue) => {
      await client.updateDoc(
        tracker.class.Issue as any,
        issue.space as Ref<Project>,
        issue._id as Ref<Issue>,
        { archived: true } as any
      )
    })
  }
  return { proyectos: staleProjects.length, tareas: staleIssues.length }
}

/** Ejecuta actualizaciones acotadas para no saturar el transactor durante el archivado. */
async function actualizarEnLotes<T> (documents: T[], update: (document: T) => Promise<void>): Promise<void> {
  for (let index = 0; index < documents.length; index += ARCHIVE_BATCH) {
    await Promise.all(documents.slice(index, index + ARCHIVE_BATCH).map(async (document) => await update(document)))
  }
}

/** Filtra ids del dump que pertenecen a un ambiente. */
export function idsDelAmbiente (
  environment: Environment,
  clients: Array<{ id: number, groups: string[] }>,
  projects: Array<{ id: number, clientid: number }>,
  tasks: Array<{ id: number, rel_id: number | null, rel_type: string | null }>
): { projectIds: Set<number>, taskIds: Set<number> } {
  const clientIds = new Set(
    clients.filter((client) => belongsToEnvironment(client.groups, environment)).map((client) => client.id)
  )
  const projectIds = new Set(projects.filter((project) => clientIds.has(project.clientid)).map((project) => project.id))
  const taskIds = new Set(tasks.filter((task) => {
    if (task.rel_type === 'project') return task.rel_id !== null && projectIds.has(task.rel_id)
    if (task.rel_type === 'customer') return task.rel_id !== null && clientIds.has(task.rel_id)
    return environment.groups.length === 0
  }).map((task) => task.id))
  return { projectIds, taskIds }
}
