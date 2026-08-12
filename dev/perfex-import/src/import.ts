//
// Migración de Perfex CRM a Huly.
//
// Se apoya en WorkspaceImporter (@hcengineering/importer) para lo pesado —tipo de proyecto,
// estados, proyectos, tareas y comentarios— y completa después los atributos que el importador
// no cubre: fechas, área de la compañía, link de Drive y archivado de proyectos cerrados.
//
import contact, { AvatarType, type ChannelProvider, type Organization, type Person } from '@hcengineering/contact'
import core, { generateId, type Data, type Ref, type TxOperations } from '@hcengineering/core'
import {
  type FileUploader,
  type ImportComment,
  type ImportIssue,
  type ImportProject,
  type ImportWorkspace,
  type Logger,
  WorkspaceImporter
} from '@hcengineering/importer'
import { markupToMarkdown } from '@hcengineering/text-markdown'
import { htmlToMarkup } from '@hcengineering/text-html'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'
import { readFileSync, writeFileSync } from 'fs'

import {
  belongsToEnvironment,
  buildProjectIdentifier,
  CLOSED_PROJECT_STATUSES,
  type Environment,
  getPriorityName,
  getStatusName,
  ORPHAN_PROJECT_IDENTIFIER,
  ORPHAN_PROJECT_NAME,
  PROJECT_TYPE_NAME,
  TASK_STATUS_ORDER,
  TASK_TYPE_NAME
} from './mapping'
import { type PerfexComment, type PerfexReader, type PerfexStaff, type PerfexTask } from './perfex'

/** Qué etapas correr. Cada una es independiente y se puede repetir sin duplicar. */
export type Stage = 'personas' | 'clientes' | 'proyectos'

export interface ImportOptions {
  /** Ambiente destino: define qué clientes, proyectos y tareas entran en esta corrida. */
  environment: Environment
  /** Etapas a ejecutar. Por defecto, todas. */
  stages: Stage[]
  /** Si es true no escribe nada en Huly: sólo lee Perfex e informa qué haría. */
  dryRun: boolean
  /** Archivo JSON donde se guarda el mapeo Perfex → Huly, para poder repetir la corrida. */
  statePath: string
}

/** Mapeo de lo ya migrado, para que una segunda corrida no duplique documentos. */
interface MigrationState {
  personas: Record<string, Ref<Person>>
  clientes: Record<string, Ref<Organization>>
  proyectos: Record<string, Ref<Project>>
  tareas: Record<string, Ref<Issue>>
}

const EMPTY_STATE: MigrationState = { personas: {}, clientes: {}, proyectos: {}, tareas: {} }

function loadState (path: string): MigrationState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch (err: any) {
    if (err.code === 'ENOENT') return { ...EMPTY_STATE }
    throw err
  }
}

function saveState (path: string, state: MigrationState): void {
  writeFileSync(path, JSON.stringify(state, null, 2))
}

/** Convierte el HTML que guarda Perfex al markdown que espera el importador. */
function htmlToMarkdown (html: string | null | undefined): string {
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
 * asignados que Huly no puede representar (sólo admite un responsable por tarea).
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
 * Ejecuta la migración.
 *
 * @param client cliente de Huly ya autenticado contra el workspace destino.
 * @param uploader subidor de archivos del front, requerido por el importador.
 * @param ensurePerson crea (o encuentra) la persona de Huly asociada a un email. Cuando esa
 * persona se registre con el mismo email, su cuenta queda vinculada a este mismo contacto.
 */
export async function importPerfex (
  client: TxOperations,
  uploader: FileUploader,
  perfex: PerfexReader,
  logger: Logger,
  ensurePerson: (email: string, firstName: string, lastName: string) => Promise<Ref<Person>>,
  options: ImportOptions
): Promise<void> {
  const state = loadState(options.statePath)
  const stages = new Set(options.stages)

  const staff = await perfex.getStaff()
  const staffById = new Map(staff.map((s) => [s.staffid, s]))

  // Los clientes definen el recorte: sólo se migra lo que cuelga de un cliente del ambiente.
  const allClients = await perfex.getClients()
  const clients = allClients.filter((c) => belongsToEnvironment(c.groups, options.environment))
  const clientIds = new Set(clients.map((c) => c.userid))
  logger.log(
    `Ambiente ${options.environment.label}: ${clients.length} de ${allClients.length} clientes, ` +
      `${staff.length} miembros del staff en Perfex`
  )

  // --- Personas -------------------------------------------------------------------------------
  // Se crean todas: el staff trabaja en varios ambientes y hace falta que estén disponibles
  // para asignar tareas también a futuro.
  if (stages.has('personas')) {
    let created = 0
    for (const person of staff) {
      if (state.personas[person.staffid] !== undefined) continue
      if (person.email.trim() === '') {
        logger.error(`Staff ${person.staffid} sin email, se omite`)
        continue
      }
      if (!options.dryRun) {
        state.personas[person.staffid] = await ensurePerson(
          person.email.trim(),
          person.firstname.trim(),
          person.lastname.trim()
        )
      }
      created++
    }
    logger.log(`Personas: ${created} nuevas${options.dryRun ? ' (simulado)' : ''}`)
    if (!options.dryRun) saveState(options.statePath, state)
  }

  // --- Clientes -------------------------------------------------------------------------------
  if (stages.has('clientes')) {
    let created = 0
    for (const client_ of clients) {
      if (state.clientes[client_.userid] !== undefined) continue
      const name = client_.company.trim()
      if (name === '') {
        logger.error(`Cliente ${client_.userid} sin nombre de empresa, se omite`)
        continue
      }
      if (!options.dryRun) {
        const orgId = generateId<Organization>()
        const data: Data<Organization> = {
          name,
          city: client_.city ?? '',
          avatarType: AvatarType.COLOR,
          members: 0,
          channels: 0,
          attachments: 0,
          comments: 0,
          description: null
        }
        await client.createDoc(contact.class.Organization, contact.space.Contacts, data, orgId)
        await addChannel(client, orgId, contact.channelProvider.Homepage, client_.website)
        await addChannel(client, orgId, contact.channelProvider.Phone, client_.phonenumber)
        state.clientes[client_.userid] = orgId
      }
      created++
    }
    logger.log(`Clientes: ${created} nuevos${options.dryRun ? ' (simulado)' : ''}`)
    if (!options.dryRun) saveState(options.statePath, state)
  }

  // --- Proyectos y tareas ---------------------------------------------------------------------
  if (stages.has('proyectos')) {
    const projects = (await perfex.getProjects()).filter((p) => clientIds.has(p.clientid))
    const projectIds = new Set(projects.map((p) => p.id))
    const allTasks = await perfex.getTasks()
    const comments = await perfex.getComments()

    // Entran las tareas de los proyectos del ambiente y las que cuelgan directo de sus clientes.
    // El resto de las tareas sueltas (de lead o sin relación) va al ambiente sin clasificar.
    const isOrphanEnvironment = options.environment.groups.length === 0
    const tasks = allTasks.filter((t) => {
      if (t.rel_type === 'project') return t.rel_id != null && projectIds.has(t.rel_id)
      if (t.rel_type === 'customer') return t.rel_id != null && clientIds.has(t.rel_id)
      return isOrphanEnvironment
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
    logger.log(
      `Perfex: ${projects.length} proyectos, ${tasks.length} tareas ` +
        `(${orphanTasks.length} sin proyecto), ${comments.length} comentarios`
    )

    // Los ids de las tareas se fijan de antemano para poder completarles los atributos
    // que el importador no escribe, sin tener que volver a buscarlas después.
    const issueIdByTask = new Map<number, Ref<Issue>>()

    const buildIssue = (task: PerfexTask): ImportIssue => {
      const issueId = generateId<Issue>()
      issueIdByTask.set(task.id, issueId)
      const description = buildIssueDescription(task, staffById)
      const assignee = task.assignees.length > 0 ? state.personas[task.assignees[0]] : undefined

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
            text:
              author !== undefined
                ? `**${`${author.firstname} ${author.lastname}`.trim()}:** ${text}`
                : text,
            date: toTimestamp(comment.dateadded) ?? undefined
          }
        })
      }
    }

    const importProjects: ImportProject[] = []
    for (const project of projects) {
      if (state.proyectos[project.id] !== undefined) continue
      importProjects.push({
        class: tracker.class.Project,
        title: project.name.trim() !== '' ? project.name : `Proyecto ${project.id}`,
        identifier: buildProjectIdentifier(project.name),
        private: false,
        autoJoin: false,
        description: htmlToMarkdown(project.description),
        docs: (tasksByProject.get(project.id) ?? []).map(buildIssue)
      })
    }

    if (orphanTasks.length > 0 && state.proyectos.orphan === undefined) {
      importProjects.push({
        class: tracker.class.Project,
        title: ORPHAN_PROJECT_NAME,
        identifier: ORPHAN_PROJECT_IDENTIFIER,
        private: false,
        autoJoin: false,
        description: 'Tareas de Perfex que no pertenecían a ningún proyecto.',
        docs: orphanTasks.map(buildIssue)
      })
    }

    logger.log(
      `A crear: ${importProjects.length} proyectos, ` +
        `${importProjects.reduce((acc, p) => acc + p.docs.length, 0)} tareas`
    )

    if (options.dryRun) {
      const sample = tasks.find((t) => t.companyArea.length > 0 && t.driveLink !== undefined)
      if (sample !== undefined) {
        logger.log(
          `Ejemplo (Perfex ${sample.id}): "${sample.name}" | áreas: ${sample.companyArea.join(' / ')} ` +
            `| drive: ${sample.driveLink ?? '-'} | responsable: ${sample.assignees[0] ?? '-'}`
        )
      }
      logger.log('Simulación: no se escribió nada en Huly')
      return
    }

    const workspaceData: ImportWorkspace = {
      projectTypes: [
        {
          name: PROJECT_TYPE_NAME,
          taskTypes: [{ name: TASK_TYPE_NAME, statuses: TASK_STATUS_ORDER }]
        }
      ],
      spaces: importProjects.map((p) => ({ ...p, projectType: { name: PROJECT_TYPE_NAME } }))
    }

    await new WorkspaceImporter(client, logger, uploader, workspaceData).performImport()

    // El importador no escribe fechas ni atributos propios del fork: se completan acá.
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
      if (Object.keys(update).length === 0) continue

      const issue = await client.findOne(tracker.class.Issue, { _id: issueId })
      if (issue === undefined) {
        logger.error(`No se encontró la tarea importada ${issueId} (Perfex ${perfexId})`)
        continue
      }
      await client.updateDoc(tracker.class.Issue, issue.space, issueId, update)
      state.tareas[perfexId] = issueId
      updated++
    }
    logger.log(`Tareas completadas con fechas y campos de Perfex: ${updated}`)

    // Se registra cada proyecto creado y se archivan los que en Perfex estaban cerrados.
    for (const project of projects) {
      if (state.proyectos[project.id] !== undefined) continue
      const created = await client.findOne(tracker.class.Project, { name: project.name })
      if (created === undefined) {
        logger.error(`No se encontró el proyecto importado "${project.name}"`)
        continue
      }
      state.proyectos[project.id] = created._id
      if (CLOSED_PROJECT_STATUSES.has(project.status)) {
        await client.updateDoc(tracker.class.Project, core.space.Space, created._id, { archived: true })
      }
    }

    saveState(options.statePath, state)
    logger.log('Migración terminada')
  }
}

/** Agrega un canal de contacto (teléfono, sitio web) a una organización, si el valor no está vacío. */
async function addChannel (
  client: TxOperations,
  orgId: Ref<Organization>,
  provider: Ref<ChannelProvider>,
  value: string | null | undefined
): Promise<void> {
  if (value == null || value.trim() === '') return
  await client.addCollection(
    contact.class.Channel,
    contact.space.Contacts,
    orgId,
    contact.class.Organization,
    'channels',
    { provider, value: value.trim() }
  )
}
