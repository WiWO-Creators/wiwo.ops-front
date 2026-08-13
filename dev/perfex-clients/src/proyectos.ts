//
// Alta en Huly de los proyectos, las tareas y los comentarios de Perfex.
//
// Se apoya en WorkspaceImporter (@hcengineering/importer) para lo pesado —tipo de proyecto,
// estados, proyectos, tareas y comentarios— y completa después los atributos que el importador
// no escribe: fechas, área de la compañía, link de Drive y archivado de los proyectos cerrados.
//
import { type Person } from '@hcengineering/contact'
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
import tracker, { type Component, type Issue, type Project } from '@hcengineering/tracker'

import { type Logger } from './import'
import { type PerfexComment, type PerfexReader, type PerfexStaff, type PerfexTask } from './perfex'
import {
  buildProjectIdentifier,
  CLOSED_PROJECT_STATUSES,
  getPriorityName,
  getStatusName,
  ORPHAN_PROJECT_IDENTIFIER,
  ORPHAN_PROJECT_NAME,
  PROJECT_TYPE_NAME,
  TASK_STATUS_ORDER,
  TASK_TYPE_NAME
} from './tareas'

export interface ProjectImportOptions {
  /** Clientes del ambiente. Cada uno es un proyecto de Huly. */
  clients: Array<{ id: number, company: string }>
  /** true en el ambiente que recoge lo que no cae en ningún otro. */
  isOrphanEnvironment: boolean
  /** Personas de Huly por staffid de Perfex, para poder asignar responsables. */
  peopleByStaffId: Record<string, Ref<Person>>
  /** Proyectos de Huly ya creados, por id de cliente de Perfex. */
  migratedProjects: Record<string, Ref<Project>>
  /** Componentes ya creados, por id de proyecto de Perfex. */
  migratedComponents: Record<string, Ref<Component>>
  /** Tareas ya migradas, por id de Perfex. Se completa durante la corrida. */
  migratedTasks: Record<string, Ref<Issue>>
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
    if (t.rel_type === 'project') return t.rel_id != null && campaignIds.has(t.rel_id)
    if (t.rel_type === 'customer') return t.rel_id != null && clientIds.has(t.rel_id)
    return options.isOrphanEnvironment
  })

  const commentsByTask = new Map<number, PerfexComment[]>()
  for (const comment of comments) {
    const list = commentsByTask.get(comment.taskid) ?? []
    list.push(comment)
    commentsByTask.set(comment.taskid, list)
  }

  // La estructura de Perfex era Cliente → Proyecto → Tarea. En Huly el proyecto pasa a ser la
  // empresa y cada proyecto de Perfex, que en la práctica es una campaña, queda como componente
  // dentro de ella. Así la barra lateral tiene una entrada por cliente y no una por campaña.
  const tasksByClient = new Map<number, PerfexTask[]>()
  const campaignByTask = new Map<number, number>()
  const leadTasks: PerfexTask[] = []

  for (const task of tasks) {
    let clientId: number | undefined
    if (task.rel_type === 'project' && task.rel_id != null) {
      clientId = campaignById.get(task.rel_id)?.clientid
      campaignByTask.set(task.id, task.rel_id)
    } else if (task.rel_type === 'customer' && task.rel_id != null) {
      clientId = task.rel_id
    }

    if (clientId === undefined || !clientIds.has(clientId)) {
      leadTasks.push(task)
      continue
    }
    const list = tasksByClient.get(clientId) ?? []
    list.push(task)
    tasksByClient.set(clientId, list)
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

  // Un proyecto de Huly por cliente que tenga campañas o tareas.
  const clientsWithWork = options.clients.filter(
    (c) => (tasksByClient.get(c.id)?.length ?? 0) > 0 || campaigns.some((p) => p.clientid === c.id)
  )

  const importProjectList: ImportProject[] = []
  for (const client_ of clientsWithWork) {
    if (options.migratedProjects[client_.id] !== undefined) continue
    importProjectList.push({
      class: tracker.class.Project,
      title: client_.company,
      identifier: buildProjectIdentifier(client_.company),
      private: false,
      autoJoin: false,
      description: '',
      docs: (tasksByClient.get(client_.id) ?? []).map(buildIssue)
    })
  }

  if (leadTasks.length > 0 && options.migratedProjects.orphan === undefined) {
    importProjectList.push({
      class: tracker.class.Project,
      title: ORPHAN_PROJECT_NAME,
      identifier: ORPHAN_PROJECT_IDENTIFIER,
      private: false,
      autoJoin: false,
      description: 'Tareas de Perfex que no pertenecían a ningún cliente.',
      docs: leadTasks.map(buildIssue)
    })
  }

  const issueCount = importProjectList.reduce((acc, p) => acc + p.docs.length, 0)
  logger.log(
    `Proyectos (uno por cliente): ${importProjectList.length}, con ${campaigns.length} componentes ` +
      `y ${issueCount} tareas` +
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

  // Se registra el proyecto de cada cliente, para poder colgarle los componentes.
  for (const client_ of clientsWithWork) {
    if (options.migratedProjects[client_.id] !== undefined) continue
    const created = await client.findOne(tracker.class.Project, { name: client_.company })
    if (created === undefined) {
      logger.error(`No se encontró el proyecto de "${client_.company}"`)
      continue
    }
    options.migratedProjects[client_.id] = created._id
  }

  // Cada proyecto de Perfex pasa a ser un componente dentro del proyecto de su cliente.
  const componentByCampaign = new Map<number, Ref<Component>>()
  for (const campaign of campaigns) {
    const projectId = options.migratedProjects[campaign.clientid]
    if (projectId === undefined) continue

    const existing = options.migratedComponents[campaign.id]
    if (existing !== undefined) {
      componentByCampaign.set(campaign.id, existing)
      continue
    }

    const componentId = generateId<Component>()
    await client.createDoc(
      tracker.class.Component,
      projectId,
      {
        label: campaign.name.trim() !== '' ? campaign.name : `Campaña ${campaign.id}`,
        description: htmlToMarkdown(campaign.description),
        lead: null,
        comments: 0
      },
      componentId
    )
    options.migratedComponents[campaign.id] = componentId
    componentByCampaign.set(campaign.id, componentId)
  }
  logger.log(`Componentes creados a partir de los proyectos de Perfex: ${componentByCampaign.size}`)

  // Fechas, componente y atributos propios del fork: nada de esto lo escribe el importador.
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  let updated = 0
  for (const [perfexId, issueId] of issueIdByTask) {
    const task = taskById.get(perfexId)
    if (task === undefined) continue

    const update: Record<string, any> = {}
    const startDate = toTimestamp(task.startdate)
    const dueDate = toTimestamp(task.duedate)
    if (startDate !== null) update.startDate = startDate
    if (dueDate !== null) update.dueDate = dueDate
    if (task.companyArea.length > 0) update.companyArea = task.companyArea
    if (task.driveLink !== undefined && task.driveLink !== '') update.driveLink = task.driveLink

    const campaignId = campaignByTask.get(perfexId)
    const component = campaignId !== undefined ? componentByCampaign.get(campaignId) : undefined
    if (component !== undefined) update.component = component

    options.migratedTasks[perfexId] = issueId
    if (Object.keys(update).length === 0) continue

    const issue = await client.findOne(tracker.class.Issue, { _id: issueId })
    if (issue === undefined) {
      logger.error(`No se encontró la tarea importada ${issueId} (Perfex ${perfexId})`)
      continue
    }
    await client.updateDoc(tracker.class.Issue, issue.space, issueId, update)
    updated++
  }
  logger.log(`Tareas completadas con componente, fechas y campos de Perfex: ${updated}`)

  // Un cliente cuyas campañas están todas cerradas ya no tiene trabajo en curso: se archiva.
  for (const client_ of clientsWithWork) {
    const projectId = options.migratedProjects[client_.id]
    if (projectId === undefined) continue
    const own = campaigns.filter((c) => c.clientid === client_.id)
    if (own.length === 0 || !own.every((c) => CLOSED_PROJECT_STATUSES.has(c.status))) continue
    await client.updateDoc(tracker.class.Project, core.space.Space, projectId, { archived: true })
  }

  options.onProgress()
}
