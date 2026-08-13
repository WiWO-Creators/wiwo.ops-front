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
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

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
  /** Ids de los clientes del ambiente: sólo entran sus proyectos y tareas. */
  clientIds: Set<number>
  /** true en el ambiente que recoge lo que no cae en ningún otro. */
  isOrphanEnvironment: boolean
  /** Personas de Huly por staffid de Perfex, para poder asignar responsables. */
  peopleByStaffId: Record<string, Ref<Person>>
  /** Proyectos ya migrados, por id de Perfex. Se completa durante la corrida. */
  migratedProjects: Record<string, Ref<Project>>
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

  const projects = (await perfex.getProjects()).filter((p) => options.clientIds.has(p.clientid))
  const projectIds = new Set(projects.map((p) => p.id))
  const allTasks = await perfex.getTasks()
  const comments = await perfex.getComments()

  // Entran las tareas de los proyectos del ambiente y las que cuelgan directo de sus clientes.
  // El resto de las sueltas (de lead o sin relación) va al ambiente que recoge lo no clasificado.
  const tasks = allTasks.filter((t) => {
    if (t.rel_type === 'project') return t.rel_id != null && projectIds.has(t.rel_id)
    if (t.rel_type === 'customer') return t.rel_id != null && options.clientIds.has(t.rel_id)
    return options.isOrphanEnvironment
  })

  const commentsByTask = new Map<number, PerfexComment[]>()
  for (const comment of comments) {
    const list = commentsByTask.get(comment.taskid) ?? []
    list.push(comment)
    commentsByTask.set(comment.taskid, list)
  }

  const tasksByProject = new Map<number, PerfexTask[]>()
  const orphanTasks: PerfexTask[] = []
  for (const task of tasks) {
    if (task.rel_type === 'project' && task.rel_id != null) {
      const list = tasksByProject.get(task.rel_id) ?? []
      list.push(task)
      tasksByProject.set(task.rel_id, list)
    } else {
      orphanTasks.push(task)
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

  const importProjectList: ImportProject[] = []
  for (const project of projects) {
    if (options.migratedProjects[project.id] !== undefined) continue
    importProjectList.push({
      class: tracker.class.Project,
      title: project.name.trim() !== '' ? project.name : `Proyecto ${project.id}`,
      identifier: buildProjectIdentifier(project.name),
      private: false,
      autoJoin: false,
      description: htmlToMarkdown(project.description),
      docs: (tasksByProject.get(project.id) ?? []).map(buildIssue)
    })
  }

  if (orphanTasks.length > 0 && options.migratedProjects.orphan === undefined) {
    importProjectList.push({
      class: tracker.class.Project,
      title: ORPHAN_PROJECT_NAME,
      identifier: ORPHAN_PROJECT_IDENTIFIER,
      private: false,
      autoJoin: false,
      description: 'Tareas de Perfex que no pertenecían a ningún proyecto.',
      docs: orphanTasks.map(buildIssue)
    })
  }

  const issueCount = importProjectList.reduce((acc, p) => acc + p.docs.length, 0)
  logger.log(
    `Proyectos y tareas: ${importProjectList.length} proyectos y ${issueCount} tareas a crear` +
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

  // Fechas y atributos propios del fork, que el importador no escribe.
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
  logger.log(`Tareas completadas con fechas y campos de Perfex: ${updated}`)

  // Se registra cada proyecto creado y se archivan los que en Perfex estaban cerrados.
  for (const project of projects) {
    if (options.migratedProjects[project.id] !== undefined) continue
    const created = await client.findOne(tracker.class.Project, { name: project.name })
    if (created === undefined) {
      logger.error(`No se encontró el proyecto importado "${project.name}"`)
      continue
    }
    options.migratedProjects[project.id] = created._id
    if (CLOSED_PROJECT_STATUSES.has(project.status)) {
      await client.updateDoc(tracker.class.Project, core.space.Space, created._id, { archived: true })
    }
  }

  options.onProgress()
}
