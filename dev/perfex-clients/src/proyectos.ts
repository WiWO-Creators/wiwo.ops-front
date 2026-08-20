//
// Alta en Huly de los proyectos, las tareas y los comentarios de Perfex.
//
// Se apoya en WorkspaceImporter (@hcengineering/importer) para lo pesado —tipo de proyecto,
// estados, proyectos, tareas y comentarios— y completa después los atributos que el importador
// no escribe: fechas, área de la compañía, link de Drive y archivado de los proyectos cerrados.
//
import { type Organization, type Person } from '@hcengineering/contact'
import core, { generateId, type Ref, type TxOperations } from '@hcengineering/core'
import {
  type FileUploader,
  type ImportComment,
  type ImportIssue,
  type ImportProject,
  type ImportWorkspace,
  WorkspaceImporter
} from '@hcengineering/importer'
import { htmlToMarkup } from '@hcengineering/text-html'
import { markupToMarkdown } from '@hcengineering/text-markdown'
import { genRanks } from '@hcengineering/rank'
import tracker, { type Issue, type Milestone, type Project } from '@hcengineering/tracker'

import { type Logger } from './import'
import {
  type PerfexComment,
  type PerfexMilestone,
  type PerfexReader,
  type PerfexStaff,
  type PerfexTask
} from './perfex'
import { toHulyMilestone } from './hitos'
import {
  buildProjectIdentifier,
  CLOSED_PROJECT_STATUSES,
  COMPLETED_TASK_STATUS,
  getPriorityName,
  getProjectStatusName,
  getStatusName,
  ORPHAN_PROJECT_IDENTIFIER,
  ORPHAN_PROJECT_NAME,
  PROJECT_TYPE_NAME,
  TASK_STATUS_ORDER,
  TASK_TYPE_NAME
} from './tareas'

/** Cuántas tareas se actualizan a la vez. Más alto satura el servidor sin ganar tiempo. */
const UPDATE_BATCH = 25

export interface ProjectImportOptions {
  /** Clientes del ambiente, para nombrar los proyectos de tareas sueltas de cada uno. */
  clients: Array<{ id: number, company: string }>
  /** true en el ambiente que recoge lo que no cae en ningún otro. */
  isOrphanEnvironment: boolean
  /** Personas de Huly por staffid de Perfex, para poder asignar responsables. */
  peopleByStaffId: Record<string, Ref<Person>>
  /** Organizaciones de Huly por id de cliente de Perfex, para vincular el proyecto a su cliente. */
  organizationsByClientId: Record<string, Ref<Organization>>
  /**
   * Proyectos de Huly ya creados. La clave es el id del proyecto de Perfex; las tareas que colgaban
   * de un cliente usan `cliente-<id>` y las sueltas, `orphan`.
   */
  migratedProjects: Record<string, Ref<Project>>
  /** Tareas ya migradas, por id de Perfex. Se completa durante la corrida. */
  migratedTasks: Record<string, Ref<Issue>>
  /** Sólo tareas creadas desde esta fecha (timestamp). Sin valor, todas. */
  tasksSince?: number
  /** Sólo tareas creadas antes de esta fecha (timestamp). Sin valor, sin tope. */
  tasksUntil?: number
  /** Si es true deja fuera las tareas ya completadas en Perfex. */
  onlyOpenTasks: boolean
  dryRun: boolean
  /** Se llama cuando hay avance que conviene persistir. */
  onProgress: () => void
}

/** Convierte el HTML que guarda Perfex al markdown que espera el importador. */
export function htmlToMarkdown (html: string | null | undefined): string {
  if (html == null || html.trim() === '') return ''
  try {
    return markupToMarkdown(htmlToMarkup(html))
  } catch (err: any) {
    // Una descripción con HTML roto no debe frenar la migración entera.
    return html.replace(/<[^>]*>/g, '').trim()
  }
}

function toTimestamp (value: string | Date | null | undefined): number | null {
  if (value == null || value === '' || value === '0000-00-00') return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return isNaN(time) ? null : time
}

/**
 * Cuerpo de la descripción de una tarea: el texto de Perfex más, si hace falta, la lista de los
 * asignados que Huly no puede representar, porque sólo admite un responsable por tarea.
 */
export function buildIssueDescription (task: PerfexTask, staffById: Map<number, PerfexStaff>): string {
  const description = htmlToMarkdown(task.description)
  const extraAssignees = task.assignees
    .slice(1)
    .map((id) => staffById.get(id))
    .filter((s): s is PerfexStaff => s !== undefined)
    .map((s) => `${s.firstname} ${s.lastname}`.trim())

  if (extraAssignees.length === 0) return description

  const note = `**Otros asignados en Perfex:** ${extraAssignees.join(', ')}`
  return description === '' ? note : `${description}\n\n${note}`
}

/**
 * Migra los proyectos, las tareas y los comentarios del ambiente indicado.
 *
 * @param client cliente de Huly ya autenticado contra el workspace destino.
 * @param uploader subidor de archivos del front, que el importador necesita.
 */
export async function importProjects (
  client: TxOperations,
  uploader: FileUploader,
  perfex: PerfexReader,
  logger: Logger,
  options: ProjectImportOptions
): Promise<void> {
  const staff = await perfex.getStaff()
  const staffById = new Map(staff.map((s) => [s.staffid, s]))

  const clientIds = new Set(options.clients.map((c) => c.id))

  const campaigns = (await perfex.getProjects()).filter((p) => clientIds.has(p.clientid))
  const campaignIds = new Set(campaigns.map((p) => p.id))
  const campaignById = new Map(campaigns.map((p) => [p.id, p]))
  const allTasks = await perfex.getTasks()
  const comments = await perfex.getComments()

  // Entran las tareas de las campañas del ambiente y las que colgaban directo de sus clientes.
  // Las de lead o sin dueño van al ambiente que recoge lo no clasificado.
  const tasks = allTasks.filter((t) => {
    // Recortes opcionales, para migrar sólo lo reciente o lo que sigue abierto.
    if (options.tasksSince !== undefined || options.tasksUntil !== undefined) {
      const created = toTimestamp(t.dateadded)
      if (created === null) return false
      if (options.tasksSince !== undefined && created < options.tasksSince) return false
      if (options.tasksUntil !== undefined && created >= options.tasksUntil) return false
    }
    if (options.onlyOpenTasks && COMPLETED_TASK_STATUS === t.status) return false

    if (t.rel_type === 'project') return t.rel_id != null && campaignIds.has(t.rel_id)
    if (t.rel_type === 'customer') return t.rel_id != null && clientIds.has(t.rel_id)
    return options.isOrphanEnvironment
  })

  const skipped = allTasks.length - tasks.length
  if (options.tasksSince !== undefined || options.tasksUntil !== undefined || options.onlyOpenTasks) {
    logger.log(`Filtro de tareas activo: entran ${tasks.length}, quedan fuera ${skipped}`)
  }

  const commentsByTask = new Map<number, PerfexComment[]>()
  for (const comment of comments) {
    const list = commentsByTask.get(comment.taskid) ?? []
    list.push(comment)
    commentsByTask.set(comment.taskid, list)
  }

  // Cada proyecto de Perfex —lo que el equipo llama campaña— pasa a ser un proyecto de Huly. Es la
  // única forma de que los permisos sean por proyecto: en Huly la visibilidad se decide por espacio,
  // así que si el espacio fuera el cliente, quien entra a una campaña vería todas las del cliente.
  // Las tareas que colgaban del cliente y no de una campaña van a un proyecto por cliente, para no
  // perder de quién son; las que no colgaban de nada, al proyecto de tareas sueltas.
  const agregar = (mapa: Map<number, PerfexTask[]>, key: number, task: PerfexTask): void => {
    const lista = mapa.get(key) ?? []
    lista.push(task)
    mapa.set(key, lista)
  }

  const tasksByCampaign = new Map<number, PerfexTask[]>()
  const tasksByClient = new Map<number, PerfexTask[]>()
  const leadTasks: PerfexTask[] = []

  for (const task of tasks) {
    if (task.rel_type === 'project' && task.rel_id != null && campaignById.has(task.rel_id)) {
      agregar(tasksByCampaign, task.rel_id, task)
    } else if (task.rel_type === 'customer' && task.rel_id != null && clientIds.has(task.rel_id)) {
      agregar(tasksByClient, task.rel_id, task)
    } else {
      leadTasks.push(task)
    }
  }

  // Los ids de las tareas se fijan de antemano para poder completarles después los atributos
  // que el importador no escribe, sin tener que volver a buscarlas.
  const issueIdByTask = new Map<number, Ref<Issue>>()

  const buildIssue = (task: PerfexTask): ImportIssue => {
    const issueId = generateId<Issue>()
    issueIdByTask.set(task.id, issueId)
    const description = buildIssueDescription(task, staffById)
    const assignee = task.assignees.length > 0 ? options.peopleByStaffId[task.assignees[0]] : undefined

    return {
      id: issueId,
      class: tracker.class.Issue,
      title: task.name?.trim() !== '' ? task.name : `Tarea ${task.id}`,
      descrProvider: async () => description,
      status: { name: getStatusName(task.status) },
      priority: getPriorityName(task.priority),
      assignee,
      subdocs: [],
      comments: (commentsByTask.get(task.id) ?? []).map((comment): ImportComment => {
        const author = comment.staffid != null ? staffById.get(comment.staffid) : undefined
        const text = htmlToMarkdown(comment.content)
        return {
          text: author !== undefined ? `**${`${author.firstname} ${author.lastname}`.trim()}:** ${text}` : text,
          date: toTimestamp(comment.dateadded) ?? undefined
        }
      })
    }
  }

  // Los proyectos nacen privados y sin miembros: quién ve qué lo reparte después el comando
  // `permisos` a partir del CSV del board, que es el único lugar donde figura el focal.
  const base = (title: string, docs: ImportIssue[], description: string): ImportProject => ({
    id: generateId<Project>(),
    class: tracker.class.Project,
    title,
    identifier: buildProjectIdentifier(title),
    private: true,
    autoJoin: false,
    members: [],
    description,
    docs
  })

  /** Lo que hay que completarle a cada proyecto una vez creado; el importador no escribe nada de esto. */
  interface Pendiente {
    key: string
    projectId: Ref<Project>
    update: Record<string, any>
  }

  const clientById = new Map(options.clients.map((c) => [c.id, c]))
  const importProjectList: ImportProject[] = []
  const pendientes: Pendiente[] = []
  const spaceByTask = new Map<number, Ref<Project>>()

  for (const campaign of campaigns) {
    const key = String(campaign.id)
    const yaCreado = options.migratedProjects[key]
    const campaignTasks = tasksByCampaign.get(campaign.id) ?? []

    if (yaCreado !== undefined) {
      for (const task of campaignTasks) spaceByTask.set(task.id, yaCreado)
      continue
    }

    const title = campaign.name?.trim() !== '' ? campaign.name : `Campaña ${campaign.id}`
    const project = base(title, campaignTasks.map(buildIssue), htmlToMarkdown(campaign.description))
    importProjectList.push(project)

    const projectId = project.id as Ref<Project>
    for (const task of campaignTasks) spaceByTask.set(task.id, projectId)

    const update: Record<string, any> = {
      perfexId: campaign.id,
      estadoBoard: getProjectStatusName(campaign.status)
    }
    const organizacion = options.organizationsByClientId[campaign.clientid]
    if (organizacion !== undefined) update.cliente = organizacion
    const inicio = toTimestamp(campaign.start_date)
    if (inicio !== null) update.fechaInicio = inicio
    const deadline = toTimestamp(campaign.deadline)
    if (deadline !== null) update.deadline = deadline
    // Una campaña terminada o cancelada ya no es trabajo en curso: se archiva.
    if (CLOSED_PROJECT_STATUSES.has(campaign.status)) update.archived = true

    pendientes.push({ key, projectId, update })
  }

  for (const [clientId, clientTasks] of tasksByClient) {
    const key = `cliente-${clientId}`
    const yaCreado = options.migratedProjects[key]
    if (yaCreado !== undefined) {
      for (const task of clientTasks) spaceByTask.set(task.id, yaCreado)
      continue
    }

    const company = clientById.get(clientId)?.company ?? `Cliente ${clientId}`
    const project = base(
      `${company} (sin campaña)`,
      clientTasks.map(buildIssue),
      'Tareas que en el board colgaban del cliente y no de una campaña.'
    )
    importProjectList.push(project)

    const projectId = project.id as Ref<Project>
    for (const task of clientTasks) spaceByTask.set(task.id, projectId)

    const update: Record<string, any> = {}
    const organizacion = options.organizationsByClientId[clientId]
    if (organizacion !== undefined) update.cliente = organizacion
    pendientes.push({ key, projectId, update })
  }

  if (leadTasks.length > 0) {
    const yaCreado = options.migratedProjects.orphan
    if (yaCreado !== undefined) {
      for (const task of leadTasks) spaceByTask.set(task.id, yaCreado)
    } else {
      const project = base(
        ORPHAN_PROJECT_NAME,
        leadTasks.map(buildIssue),
        'Tareas de Perfex que no pertenecían a ningún cliente.'
      )
      project.identifier = ORPHAN_PROJECT_IDENTIFIER
      importProjectList.push(project)

      const projectId = project.id as Ref<Project>
      for (const task of leadTasks) spaceByTask.set(task.id, projectId)
      pendientes.push({ key: 'orphan', projectId, update: {} })
    }
  }

  const issueCount = importProjectList.reduce((acc, p) => acc + p.docs.length, 0)
  logger.log(
    `Proyectos (uno por campaña): ${importProjectList.length}, con ${issueCount} tareas` +
      (options.dryRun ? ' (simulado)' : '')
  )
  if (options.dryRun) return

  const workspaceData: ImportWorkspace = {
    projectTypes: [
      {
        name: PROJECT_TYPE_NAME,
        taskTypes: [{ name: TASK_TYPE_NAME, statuses: TASK_STATUS_ORDER }]
      }
    ],
    spaces: importProjectList.map((p) => ({ ...p, projectType: { name: PROJECT_TYPE_NAME } }))
  }

  await new WorkspaceImporter(client, logger, uploader, workspaceData).performImport()

  // Cliente, id de Perfex, estado y fechas: el importador no escribe ninguno de los cuatro.
  for (const { key, projectId, update } of pendientes) {
    options.migratedProjects[key] = projectId
    if (Object.keys(update).length > 0) {
      await client.updateDoc(tracker.class.Project, core.space.Space, projectId, update)
    }
  }
  options.onProgress()

  // Fechas y atributos propios del fork: tampoco los escribe el importador.
  //
  // Se arma la lista completa y después se manda por tandas en paralelo. Ir de a una tarea, y
  // encima buscándola antes de tocarla, era lo que hacía eternas las corridas grandes.
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const pending: Array<{ issueId: Ref<Issue>, space: Ref<Project>, update: Record<string, any> }> = []

  for (const [perfexId, issueId] of issueIdByTask) {
    const task = taskById.get(perfexId)
    if (task === undefined) continue
    options.migratedTasks[perfexId] = issueId

    const update: Record<string, any> = {}
    const startDate = toTimestamp(task.startdate)
    const dueDate = toTimestamp(task.duedate)
    if (startDate !== null) update.startDate = startDate
    if (dueDate !== null) update.dueDate = dueDate
    if (task.companyArea.length > 0) update.companyArea = task.companyArea
    if (task.driveLink !== undefined && task.driveLink !== '') update.driveLink = task.driveLink
    if (Object.keys(update).length === 0) continue

    const space = spaceByTask.get(perfexId)
    if (space === undefined) continue
    pending.push({ issueId, space, update })
  }

  let updated = 0
  for (let i = 0; i < pending.length; i += UPDATE_BATCH) {
    const batch = pending.slice(i, i + UPDATE_BATCH)
    await Promise.all(
      batch.map(async ({ issueId, space, update }) => {
        await client.updateDoc(tracker.class.Issue, space, issueId, update)
      })
    )
    updated += batch.length
    // Señal de vida en corridas largas, para poder seguirlas por el archivo de log.
    logger.log(`  ... ${updated} de ${pending.length} tareas completadas`)
    options.onProgress()
  }
  logger.log(`Tareas completadas con fechas y campos de Perfex: ${updated}`)

  options.onProgress()
}

/** Lo que necesita la carga de hitos, todo salido del estado de la migración. */
export interface MilestoneImportOptions {
  /** Proyectos de Huly ya creados, por id de proyecto de Perfex. */
  migratedProjects: Record<string, Ref<Project>>
  /** Tareas de Huly ya creadas, por id de tarea de Perfex. */
  migratedTasks: Record<string, Ref<Issue>>
  /** Hitos ya creados, por id de hito de Perfex. Se completa durante la corrida. */
  migratedMilestones: Record<string, Ref<Milestone>>
  dryRun: boolean
  /** Se llama cuando hay avance que conviene persistir. */
  onProgress: () => void
}

/**
 * Crea en Huly los hitos de Perfex y le pone su hito a cada tarea.
 *
 * Corre después de los proyectos y las tareas, y se apoya sólo en el estado de la migración, así
 * que se puede volver a correr sola sobre un workspace ya migrado. Un hito cuyo proyecto no está
 * en este ambiente se saltea, igual que una tarea cuyo hito quedó afuera.
 */
export async function importMilestones (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: MilestoneImportOptions
): Promise<void> {
  const milestones = await perfex.getMilestones()
  const tasks = await perfex.getTasks()

  const tasksByMilestone = new Map<number, PerfexTask[]>()
  for (const task of tasks) {
    if (task.milestone === 0) continue
    const list = tasksByMilestone.get(task.milestone) ?? []
    list.push(task)
    tasksByMilestone.set(task.milestone, list)
  }

  // Sólo los hitos cuyo proyecto vive en este ambiente y que todavía no se crearon.
  const pendientes = milestones.filter(
    (m) =>
      options.migratedProjects[String(m.project_id)] !== undefined &&
      options.migratedMilestones[String(m.id)] === undefined
  )

  logger.log(`Hitos a crear: ${pendientes.length} de ${milestones.length}` + (options.dryRun ? ' (simulado)' : ''))
  if (options.dryRun) return

  // El orden manual de Perfex se traduce a los rangos que usa Huly, proyecto por proyecto, para
  // que las columnas del tablero queden como estaban en el board.
  const porProyecto = new Map<number, PerfexMilestone[]>()
  for (const milestone of pendientes) {
    const list = porProyecto.get(milestone.project_id) ?? []
    list.push(milestone)
    porProyecto.set(milestone.project_id, list)
  }

  let creados = 0
  for (const [projectId, list] of porProyecto) {
    const space = options.migratedProjects[String(projectId)]
    list.sort((a, b) => (a.milestone_order !== b.milestone_order ? a.milestone_order - b.milestone_order : a.id - b.id))
    const ranks = genRanks(list.length)

    for (const [posicion, milestone] of list.entries()) {
      const datos = toHulyMilestone(milestone, tasksByMilestone.get(milestone.id) ?? [])
      const milestoneId = generateId<Milestone>()
      const rank = ranks[posicion]

      await client.createDoc(
        tracker.class.Milestone,
        space,
        {
          label: datos.label,
          description: htmlToMarkdown(milestone.description),
          status: datos.status,
          startDate: datos.startDate,
          targetDate: datos.targetDate,
          comments: 0,
          ...(datos.color !== undefined ? { color: datos.color } : {}),
          ...(rank !== undefined ? { rank } : {})
        },
        milestoneId
      )
      options.migratedMilestones[String(milestone.id)] = milestoneId
      creados++
    }
    options.onProgress()
  }
  logger.log(`Hitos creados: ${creados}`)

  // Y ahora la otra mitad: cada tarea apunta a su hito. Va por tandas, como el resto.
  const pendingTasks: Array<{ issueId: Ref<Issue>, space: Ref<Project>, milestone: Ref<Milestone> }> = []
  for (const task of tasks) {
    if (task.milestone === 0) continue
    const issueId = options.migratedTasks[String(task.id)]
    const milestone = options.migratedMilestones[String(task.milestone)]
    if (issueId === undefined || milestone === undefined) continue

    const perfexMilestone = milestones.find((m) => m.id === task.milestone)
    if (perfexMilestone === undefined) continue
    const space = options.migratedProjects[String(perfexMilestone.project_id)]
    if (space === undefined) continue

    pendingTasks.push({ issueId, space, milestone })
  }

  let updated = 0
  for (let i = 0; i < pendingTasks.length; i += UPDATE_BATCH) {
    const batch = pendingTasks.slice(i, i + UPDATE_BATCH)
    await Promise.all(
      batch.map(async ({ issueId, space, milestone }) => {
        await client.updateDoc(tracker.class.Issue, space, issueId, { milestone })
      })
    )
    updated += batch.length
    logger.log(`  ... ${updated} de ${pendingTasks.length} tareas con hito`)
    options.onProgress()
  }
  logger.log(`Tareas asociadas a su hito: ${updated}`)

  options.onProgress()
}
