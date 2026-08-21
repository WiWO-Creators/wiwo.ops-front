//
// Migración de los checklists de tareas de Perfex como subtareas de ops.
//
import { type Person } from '@hcengineering/contact'
import { type Ref, type TxOperations } from '@hcengineering/core'
import { type FileUploader, type ImportIssue, WorkspaceImporter } from '@hcengineering/importer'
import { type Logger, type PerfexChecklistItem, type PerfexReader } from '@hcengineering/perfex'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import { COMPLETED_TASK_STATUS, getStatusName } from './tareas'

/** Máximo de ids que se consultan juntos al buscar tareas e hijos existentes. */
const QUERY_BATCH = 500

export interface TareaPadre {
  id: Ref<Issue>
  space: Ref<Project>
  milestone: Issue['milestone']
  title: string
  identifier: string
}

interface ChecklistPlanificado {
  item: PerfexChecklistItem
  parent: TareaPadre
}

export interface ChecklistImportOptions {
  /** Si es true sólo informa cuántos checklists hay en el board. */
  dryRun: boolean
  /** Personas de ops por staffid de Perfex, para asignar la subtarea cuando corresponda. */
  peopleByStaffId: Record<string, Ref<Person>>
}

/** Clave estable de un ítem de checklist dentro de su tarea padre. */
export function claveDeChecklist(parentId: Ref<Issue>, checklistId: number): string {
  return `${parentId}:${checklistId}`
}

/**
 * Deja sólo los checklists cuyos padres existen y que todavía no se migraron.
 *
 * @returns los pendientes, ordenados por padre, posición e id, y los ítems sin tarea padre.
 */
export function planificarChecklists(
  items: PerfexChecklistItem[],
  parents: Map<number, TareaPadre>,
  existentes: Set<string>
): { pendientes: ChecklistPlanificado[]; sinPadre: PerfexChecklistItem[] } {
  const pendientes: ChecklistPlanificado[] = []
  const sinPadre: PerfexChecklistItem[] = []

  for (const item of items) {
    const parent = parents.get(item.taskid)
    if (parent === undefined) {
      sinPadre.push(item)
      continue
    }
    if (!existentes.has(claveDeChecklist(parent.id, item.id))) pendientes.push({ item, parent })
  }

  pendientes.sort(
    (a, b) => a.item.taskid - b.item.taskid || a.item.list_order - b.item.list_order || a.item.id - b.item.id
  )
  return { pendientes, sinPadre }
}

/** Convierte un ítem de Perfex en la subtarea que crea el importador de Huly. */
export function aSubtarea(
  item: PerfexChecklistItem,
  parent: TareaPadre,
  assignee: Ref<Person> | undefined
): ImportIssue {
  return {
    class: tracker.class.Issue,
    title: item.description.trim() !== '' ? item.description : `Checklist ${item.id}`,
    descrProvider: async () => '',
    status: { name: getStatusName(item.finished === 1 ? COMPLETED_TASK_STATUS : 1) },
    assignee,
    subdocs: [],
    additionalData: { milestone: parent.milestone, perfexId: item.id }
  }
}

/**
 * Crea en ops las subtareas que representan los checklists de Perfex.
 *
 * La tarea padre y el ítem de checklist forman una ancla estable, por lo que repetir la etapa sólo
 * reintenta los que hayan quedado pendientes tras un fallo parcial.
 */
export async function importChecklists(
  client: TxOperations,
  uploader: FileUploader,
  perfex: PerfexReader,
  logger: Logger,
  options: ChecklistImportOptions
): Promise<void> {
  const items = await perfex.getChecklistItems()
  logger.log(
    `Checklists en el board: ${items.length} ítem(s) sobre ${new Set(items.map((item) => item.taskid)).size} tarea(s)` +
      (options.dryRun ? ' (simulado)' : '')
  )
  if (options.dryRun || items.length === 0) return

  const parents = await tareasPadrePorPerfexId(
    client,
    items.map((item) => item.taskid)
  )
  const existentes = await checklistsExistentes(
    client,
    [...parents.values()].map((parent) => parent.id),
    items.map((item) => item.id)
  )
  const { pendientes, sinPadre } = planificarChecklists(items, parents, existentes)
  informarPadresFaltantes(logger, sinPadre)
  logger.log(`Checklists a crear: ${pendientes.length} de ${items.length}`)
  if (pendientes.length === 0) return

  const projects = await proyectosPorId(
    client,
    pendientes.map((checklist) => checklist.parent.space)
  )
  const importer = new WorkspaceImporter(client, logger, uploader, {})
  const sinCuenta = new Set<number>()
  let creados = 0
  let fallidos = 0

  for (const checklist of pendientes) {
    const project = projects.get(checklist.parent.space)
    if (project === undefined) {
      logger.error(`Checklist ${checklist.item.id}: no existe el proyecto de la tarea ${checklist.item.taskid}`)
      fallidos++
      continue
    }

    const assigned = checklist.item.assigned
    const assignee = assigned !== null && assigned !== 0 ? options.peopleByStaffId[assigned] : undefined
    if (assigned !== null && assigned !== 0 && assignee === undefined) sinCuenta.add(assigned)

    try {
      await importer.createIssueWithSubissues(
        aSubtarea(checklist.item, checklist.parent, assignee),
        checklist.parent.id,
        project,
        checklist.parent.space,
        [
          {
            parentId: checklist.parent.id,
            parentTitle: checklist.parent.title,
            identifier: checklist.parent.identifier,
            space: checklist.parent.space
          }
        ]
      )
      creados++
    } catch (err: any) {
      logger.error(`Checklist ${checklist.item.id}: ${err.message}`)
      fallidos++
    }
  }

  if (sinCuenta.size > 0) {
    logger.error(
      `${sinCuenta.size} responsable(s) de checklist sin persona en ops: ${[...sinCuenta].join(', ')}. ` +
        'Las subtareas se crearon sin responsable.'
    )
  }
  logger.log(`Checklists creados: ${creados} de ${pendientes.length}`)
  if (fallidos > 0) logger.error(`Quedaron ${fallidos} checklists pendientes; repetir la etapa los reintenta`)
}

/** Tareas padre existentes por id de Perfex, con lo necesario para crear subtareas. */
async function tareasPadrePorPerfexId(client: TxOperations, ids: number[]): Promise<Map<number, TareaPadre>> {
  const parents = new Map<number, TareaPadre>()
  const unicos = [...new Set(ids)]
  for (let i = 0; i < unicos.length; i += QUERY_BATCH) {
    const issues = await client.findAll<Issue>(
      tracker.class.Issue,
      { perfexId: { $in: unicos.slice(i, i + QUERY_BATCH) } },
      { projection: { _id: 1, perfexId: 1, space: 1, milestone: 1, title: 1, identifier: 1 } }
    )
    for (const issue of issues) {
      if (issue.perfexId === undefined) continue
      parents.set(issue.perfexId, {
        id: issue._id,
        space: issue.space,
        milestone: issue.milestone,
        title: issue.title,
        identifier: issue.identifier
      })
    }
  }
  return parents
}

/** Claves de los checklists ya creados bajo una de las tareas padre. */
async function checklistsExistentes(
  client: TxOperations,
  parentIds: Array<Ref<Issue>>,
  checklistIds: number[]
): Promise<Set<string>> {
  const existentes = new Set<string>()
  const parents = [...new Set(parentIds)]
  const items = [...new Set(checklistIds)]
  for (let i = 0; i < parents.length; i += QUERY_BATCH) {
    const issues = await client.findAll<Issue>(
      tracker.class.Issue,
      {
        attachedTo: { $in: parents.slice(i, i + QUERY_BATCH) },
        perfexId: { $in: items }
      },
      { projection: { _id: 1, attachedTo: 1, perfexId: 1 } }
    )
    for (const issue of issues) {
      if (issue.perfexId !== undefined) existentes.add(claveDeChecklist(issue.attachedTo as Ref<Issue>, issue.perfexId))
    }
  }
  return existentes
}

/** Proyectos de las tareas padre, para que el importador cree sus hijos con el tipo correcto. */
async function proyectosPorId(client: TxOperations, ids: Array<Ref<Project>>): Promise<Map<Ref<Project>, Project>> {
  const projects = new Map<Ref<Project>, Project>()
  const unicos = [...new Set(ids)]
  for (let i = 0; i < unicos.length; i += QUERY_BATCH) {
    const encontrados = await client.findAll<Project>(tracker.class.Project, {
      _id: { $in: unicos.slice(i, i + QUERY_BATCH) }
    })
    for (const project of encontrados) projects.set(project._id, project)
  }
  return projects
}

/** Informa los checklists cuyos padres todavía no se migraron a este workspace. */
function informarPadresFaltantes(logger: Logger, items: PerfexChecklistItem[]): void {
  if (items.length === 0) return
  const tasks = [...new Set(items.map((item) => item.taskid))]
  logger.error(
    `${items.length} checklists de ${tasks.length} tarea(s) no tienen padre en este workspace: ${tasks.join(', ')}. ` +
      'Se omiten y una segunda corrida los retomará.'
  )
}
