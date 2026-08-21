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
  claveDeComentario,
  claveDeHito,
  comentariosPorTareaYFecha,
  hitosPorProyectoYNombre,
  normalizarNombre,
  proyectosPorNombre,
  proyectosPorPerfexId,
  tareasPorPerfexId
} from './existente'
import {
  type PerfexComment,
  type PerfexMilestone,
  type PerfexReader,
  type PerfexStaff,
  type PerfexTask
} from '@hcengineering/perfex'
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
  /** Sólo tareas creadas desde esta fecha (timestamp). Sin valor, todas. */
  tasksSince?: number
  /** Sólo tareas creadas antes de esta fecha (timestamp). Sin valor, sin tope. */
  tasksUntil?: number
  /** Si es true deja fuera las tareas ya completadas en Perfex. */
  onlyOpenTasks: boolean
  dryRun: boolean
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
 * Cuerpo de la descripción de una tarea: el texto de Perfex, traducido a markdown.
 *
 * Los asignados que Huly no puede representar —sólo admite un responsable por tarea— ya no van
 * acá como nota: la etapa `colaboradores` los da de alta como colaboradores de la tarea, que sí
 * es un dato consultable.
 */
export function buildIssueDescription (task: PerfexTask): string {
  return htmlToMarkdown(task.description)
}

/**
 * Comentario de Perfex traducido a comentario de ops.
 *
 * El autor va dentro del texto porque los comentarios se escriben con la cuenta que corre la
 * migración: el staff del board todavía no tiene cuenta propia en ops.
 */
export function buildComment (comment: PerfexComment, staffById: Map<number, PerfexStaff>): ImportComment {
  const author = comment.staffid != null ? staffById.get(comment.staffid) : undefined
  const text = htmlToMarkdown(comment.content)
  return {
    text: author !== undefined ? `**${`${author.firstname} ${author.lastname}`.trim()}:** ${text}` : text,
    date: toTimestamp(comment.dateadded) ?? undefined
  }
}

/** Un proyecto de ops con las tareas del board que le corresponden. */
export interface Destino {
  /** Nombre del proyecto, que es el ancla de los que no salen de una campaña. */
  title: string
  description: string
  /** Identificador fijo, sólo para el proyecto de tareas huérfanas. */
  identifier?: string
  tasks: PerfexTask[]
  /** Atributos que el importador no escribe y hay que completar cuando el proyecto es nuevo. */
  update: Record<string, any>
  /** Proyecto de ops si ya existe; `undefined` si hay que crearlo. */
  existente?: Ref<Project>
  /**
   * true si el proyecto se reconoció por nombre y no por `perfexId`.
   *
   * Pasa con los proyectos que dejaron corridas viejas, anteriores al ancla. Se les completa el
   * `perfexId` para que las pasadas de etiquetas, hitos y adjuntos los encuentren.
   */
  sinAncla?: boolean
}

/** Qué hay que escribir en ops y qué ya está. */
export interface PlanDeProyectos {
  /** Proyectos que no existen: se crean enteros, con sus tareas. */
  porCrear: Destino[]
  /** Proyectos que ya existen y tienen tareas nuevas para agregar. */
  porCompletar: Destino[]
  /** Las tareas nuevas de cada destino, por nombre de destino. */
  tareasNuevas: Map<string, PerfexTask[]>
  /** Total de tareas a crear en esta corrida. */
  total: number
}

/**
 * Decide qué crear, mirando tarea por tarea y no proyecto por proyecto.
 *
 * Es la regla que hace repetible la migración: una tarea ya migrada no se vuelve a crear, y una
 * tarea nueva se crea aunque su proyecto sea de una corrida anterior. Saltear el proyecto entero
 * —lo que hacía la versión vieja— dejaba fuera para siempre toda tarea cargada en el board después
 * de la primera corrida.
 *
 * @param tareasExistentes ids de tarea de Perfex que ya están en el workspace.
 */
export function planificarProyectos (destinos: Destino[], tareasExistentes: Set<number>): PlanDeProyectos {
  const tareasNuevas = new Map<string, PerfexTask[]>()
  for (const destino of destinos) {
    tareasNuevas.set(
      destino.title,
      destino.tasks.filter((t) => !tareasExistentes.has(t.id))
    )
  }

  const nuevasDe = (d: Destino): PerfexTask[] => tareasNuevas.get(d.title) ?? []
  return {
    porCrear: destinos.filter((d) => d.existente === undefined),
    porCompletar: destinos.filter((d) => d.existente !== undefined && nuevasDe(d).length > 0),
    tareasNuevas,
    total: destinos.reduce((acc, d) => acc + nuevasDe(d).length, 0)
  }
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
  const spaceByExistingTask = new Map<number, { id: Ref<Issue>, space: Ref<Project> }>()

  const buildIssue = (task: PerfexTask): ImportIssue => {
    const issueId = generateId<Issue>()
    issueIdByTask.set(task.id, issueId)
    const description = buildIssueDescription(task)
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
      comments: (commentsByTask.get(task.id) ?? []).map((comment) => buildComment(comment, staffById))
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

  // Lo que ya está en ops manda: las campañas se reconocen por su id de Perfex y los dos proyectos
  // que no salen de una campaña, por su nombre.
  const campañasExistentes = await proyectosPorPerfexId(
    client,
    campaigns.map((c) => c.id)
  )
  const proyectosExistentes = await proyectosPorNombre(client)
  const tareasExistentes = await tareasPorPerfexId(
    client,
    tasks.map((t) => t.id)
  )
  for (const [perfexId, existing] of tareasExistentes) {
    issueIdByTask.set(perfexId, existing.id)
    spaceByExistingTask.set(perfexId, existing)
  }

  const destinos: Destino[] = []

  for (const campaign of campaigns) {
    const title = campaign.name?.trim() !== '' ? campaign.name : `Campaña ${campaign.id}`
    const update: Record<string, any> = {
      perfexId: campaign.id,
      estadoBoard: getProjectStatusName(campaign.status),
      name: title,
      description: htmlToMarkdown(campaign.description),
      archived: CLOSED_PROJECT_STATUSES.has(campaign.status)
    }
    const organizacion = options.organizationsByClientId[campaign.clientid]
    if (organizacion !== undefined) update.cliente = organizacion
    const inicio = toTimestamp(campaign.start_date)
    if (inicio !== null) update.fechaInicio = inicio
    const deadline = toTimestamp(campaign.deadline)
    if (deadline !== null) update.deadline = deadline
    if (campaign.numeroCotizacion !== undefined) update.numeroCotizacion = campaign.numeroCotizacion
    if (campaign.palabraClave !== undefined) update.palabraClave = campaign.palabraClave
    // Una campaña terminada o cancelada ya no es trabajo en curso: se archiva.
    const anclado = campañasExistentes.get(campaign.id)
    const porNombre = proyectosExistentes.get(normalizarNombre(title))
    destinos.push({
      title,
      description: htmlToMarkdown(campaign.description),
      tasks: tasksByCampaign.get(campaign.id) ?? [],
      update,
      existente: anclado ?? porNombre,
      sinAncla: anclado === undefined && porNombre !== undefined
    })
  }

  for (const [clientId, clientTasks] of tasksByClient) {
    const company = clientById.get(clientId)?.company ?? `Cliente ${clientId}`
    const title = `${company} (sin campaña)`
    const update: Record<string, any> = {}
    const organizacion = options.organizationsByClientId[clientId]
    if (organizacion !== undefined) update.cliente = organizacion

    destinos.push({
      title,
      description: 'Tareas que en el board colgaban del cliente y no de una campaña.',
      tasks: clientTasks,
      update,
      existente: proyectosExistentes.get(normalizarNombre(title))
    })
  }

  if (leadTasks.length > 0) {
    destinos.push({
      title: ORPHAN_PROJECT_NAME,
      description: 'Tareas de Perfex que no pertenecían a ningún cliente.',
      identifier: ORPHAN_PROJECT_IDENTIFIER,
      tasks: leadTasks,
      update: {},
      existente: proyectosExistentes.get(normalizarNombre(ORPHAN_PROJECT_NAME))
    })
  }

  const plan = planificarProyectos(destinos, new Set(tareasExistentes.keys()))
  const { porCrear, porCompletar } = plan
  const nuevas = (destino: Destino): PerfexTask[] => plan.tareasNuevas.get(destino.title) ?? []

  logger.log(
    `Proyectos: ${porCrear.length} a crear, ${destinos.length - porCrear.length} ya existían ` +
      `(${porCompletar.length} con tareas nuevas). Tareas a migrar: ${plan.total} de ` +
      `${tasks.length}${options.dryRun ? ' (simulado)' : ''}`
  )
  if (options.dryRun) return

  const spaceByTask = new Map<number, Ref<Project>>()
  for (const [perfexId, existing] of spaceByExistingTask) spaceByTask.set(perfexId, existing.space)
  const pendientes: Array<{ projectId: Ref<Project>, update: Record<string, any> }> = []

  // --- Proyectos nuevos, con sus tareas y comentarios, vía el importador -----------------------
  const importProjectList: ImportProject[] = porCrear.map((destino) => {
    const projectId = generateId<Project>()
    const project: ImportProject = {
      id: projectId,
      class: tracker.class.Project,
      title: destino.title,
      identifier: destino.identifier ?? buildProjectIdentifier(destino.title),
      // Los proyectos nacen privados y sin miembros: quién ve qué lo reparte después el comando
      // `permisos` a partir del CSV del board, que es el único lugar donde figura el focal.
      private: true,
      autoJoin: false,
      members: [],
      description: destino.description,
      docs: nuevas(destino).map(buildIssue)
    }
    for (const task of nuevas(destino)) spaceByTask.set(task.id, projectId)
    pendientes.push({ projectId, update: destino.update })
    return project
  })

  const workspaceData: ImportWorkspace = {
    projectTypes: [
      {
        name: PROJECT_TYPE_NAME,
        taskTypes: [{ name: TASK_TYPE_NAME, statuses: TASK_STATUS_ORDER }]
      }
    ],
    spaces: importProjectList.map((p) => ({ ...p, projectType: { name: PROJECT_TYPE_NAME } }))
  }

  const importer = new WorkspaceImporter(client, logger, uploader, workspaceData)
  if (importProjectList.length > 0) await importer.performImport()

  // Cliente, id de Perfex, estado y fechas: el importador no escribe ninguno de los cuatro. Los
  // proyectos viejos que se reconocieron por nombre entran acá también, para que les quede el ancla.
  for (const destino of destinos) {
    if (destino.sinAncla === true && destino.existente !== undefined) {
      pendientes.push({ projectId: destino.existente, update: destino.update })
    }
  }
  let anclados = 0
  for (const { projectId, update } of pendientes) {
    if (Object.keys(update).length > 0) {
      await client.updateDoc(tracker.class.Project, core.space.Space, projectId, update)
      anclados++
    }
  }
  const reparados = destinos.filter((d) => d.sinAncla === true).length
  if (reparados > 0) logger.log(`Proyectos viejos a los que se les completó el id de Perfex: ${reparados}`)
  if (anclados > 0) logger.log(`Proyectos completados con cliente, estado y fechas: ${anclados}`)

  // --- Tareas nuevas de proyectos que ya existían ----------------------------------------------
  await crearTareasSueltas(
    client,
    importer,
    logger,
    porCompletar.map((d) => ({ title: d.title, projectId: d.existente as Ref<Project>, tasks: nuevas(d) })),
    buildIssue,
    spaceByTask
  )

  // --- Comentarios nuevos de tareas que ya existían ---------------------------------------------
  await crearComentariosFaltantes(client, importer, logger, tasks, tareasExistentes, commentsByTask, staffById)

  // Fechas y atributos propios del fork: tampoco los escribe el importador.
  //
  // Se arma la lista completa y después se manda por tandas en paralelo. Ir de a una tarea, y
  // encima buscándola antes de tocarla, era lo que hacía eternas las corridas grandes.
  const taskById = new Map<number, PerfexTask>(tasks.map((task): [number, PerfexTask] => [task.id, task]))
  const statuses = await client.findAll(tracker.class.IssueStatus, {}, { projection: { _id: 1, name: 1 } })
  const statusByName = new Map(statuses.map((status) => [status.name, status._id]))
  const pending: Array<{ issueId: Ref<Issue>, space: Ref<Project>, update: Record<string, any> }> = []

  for (const [perfexId, issueId] of issueIdByTask) {
    const task = taskById.get(perfexId)
    if (task === undefined) continue
    const space = spaceByTask.get(perfexId)
    if (space === undefined) continue

    // El id de Perfex viaja con la tarea para que las migraciones posteriores la encuentren sin
    // depender de nada local. Sin él, la tarea queda huérfana para etiquetas, hitos y adjuntos.
    const update: Record<string, any> = {
      perfexId,
      title: task.name?.trim() !== '' ? task.name : `Tarea ${task.id}`,
      assignee: task.assignees.length > 0 ? options.peopleByStaffId[task.assignees[0]] ?? null : null,
      priority: getPriorityName(task.priority),
      startDate: toTimestamp(task.startdate),
      dueDate: toTimestamp(task.duedate),
      companyArea: task.companyArea,
      driveLink: task.driveLink ?? ''
    }
    const status = statusByName.get(getStatusName(task.status))
    if (status !== undefined) update.status = status
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
  }
  logger.log(`Tareas completadas con fechas y campos de Perfex: ${updated}`)
}

/**
 * Crea las tareas nuevas de los proyectos que ya existían en ops.
 *
 * El importador sólo sabe crear un proyecto entero de una vez, así que estas tareas se dan de alta
 * de a una contra el proyecto que ya está.
 */
async function crearTareasSueltas (
  client: TxOperations,
  importer: WorkspaceImporter,
  logger: Logger,
  destinos: Array<{ title: string, projectId: Ref<Project>, tasks: PerfexTask[] }>,
  buildIssue: (task: PerfexTask) => ImportIssue,
  spaceByTask: Map<number, Ref<Project>>
): Promise<void> {
  if (destinos.length === 0) return

  const proyectos = await client.findAll(tracker.class.Project, {
    _id: { $in: destinos.map((d) => d.projectId) }
  })
  const porId = new Map(proyectos.map((p) => [p._id, p]))

  let creadas = 0
  for (const { title, projectId, tasks } of destinos) {
    const proyecto = porId.get(projectId)
    if (proyecto === undefined) {
      logger.error(`No se encontró el proyecto "${title}" para agregarle tareas nuevas`)
      continue
    }

    for (const task of tasks) {
      const issue = buildIssue(task)
      await importer.createIssueWithSubissues(issue, tracker.ids.NoParent, proyecto, projectId, [])
      spaceByTask.set(task.id, projectId)
      creadas++
      if (creadas % UPDATE_BATCH === 0) logger.log(`  ... ${creadas} tareas nuevas creadas`)
    }
  }
  logger.log(`Tareas nuevas en proyectos ya existentes: ${creadas}`)
}

/**
 * Crea los comentarios que se cargaron en el board después de que la tarea ya estaba migrada.
 *
 * El comentario migrado no guarda el id de Perfex, pero sí la fecha del original: tarea más fecha
 * alcanza para saber cuál falta.
 */
async function crearComentariosFaltantes (
  client: TxOperations,
  importer: WorkspaceImporter,
  logger: Logger,
  tasks: PerfexTask[],
  tareasExistentes: Map<number, { id: Ref<Issue>, space: Ref<Project> }>,
  commentsByTask: Map<number, PerfexComment[]>,
  staffById: Map<number, PerfexStaff>
): Promise<void> {
  const conComentarios = tasks.filter((t) => tareasExistentes.has(t.id) && (commentsByTask.get(t.id)?.length ?? 0) > 0)
  if (conComentarios.length === 0) return

  const yaPuestos = await comentariosPorTareaYFecha(
    client,
    conComentarios.map((t) => tareasExistentes.get(t.id)?.id as Ref<Issue>)
  )

  let creados = 0
  for (const task of conComentarios) {
    const tarea = tareasExistentes.get(task.id)
    if (tarea === undefined) continue

    for (const comment of commentsByTask.get(task.id) ?? []) {
      const fecha = toTimestamp(comment.dateadded) ?? undefined
      if (yaPuestos.has(claveDeComentario(tarea.id, fecha))) continue

      await importer.createComment(tarea.id, buildComment(comment, staffById), tarea.space)
      creados++
    }
  }
  logger.log(`Comentarios nuevos en tareas ya migradas: ${creados}`)
}

/** Lo que necesita la carga de hitos. */
export interface MilestoneImportOptions {
  dryRun: boolean
}

/**
 * Crea en Huly los hitos de Perfex y le pone su hito a cada tarea.
 *
 * Corre después de los proyectos y las tareas, y encuentra todo por consulta al workspace: el
 * proyecto por su `perfexId`, la tarea por el suyo y el hito por su nombre dentro del proyecto. Un
 * hito cuyo proyecto no está en este ambiente se saltea, igual que una tarea cuyo hito quedó
 * afuera. Volver a correrla no duplica nada.
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

  if (options.dryRun) {
    logger.log(`Hitos en el board: ${milestones.length} (simulado)`)
    return
  }

  // Sólo los hitos cuyo proyecto vive en este ambiente.
  const proyectos = await proyectosPorPerfexId(
    client,
    milestones.map((m) => m.project_id)
  )
  const delAmbiente = milestones.filter((m) => proyectos.has(m.project_id))
  const hitosExistentes = await hitosPorProyectoYNombre(client, [...proyectos.values()])

  const hitoDe = (milestone: PerfexMilestone): Ref<Milestone> | undefined => {
    const space = proyectos.get(milestone.project_id)
    if (space === undefined) return undefined
    return hitosExistentes.get(claveDeHito(space, toHulyMilestone(milestone, []).label))
  }

  const pendientes = delAmbiente.filter((m) => hitoDe(m) === undefined)
  logger.log(`Hitos a crear: ${pendientes.length} de ${delAmbiente.length} en este ambiente`)

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
    const space = proyectos.get(projectId) as Ref<Project>
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
      hitosExistentes.set(claveDeHito(space, datos.label), milestoneId)
      creados++
    }
  }
  logger.log(`Hitos creados: ${creados}`)

  // Y ahora la otra mitad: cada tarea apunta a su hito. Va por tandas, como el resto.
  const pendingTasks: Array<{ issueId: Ref<Issue>, space: Ref<Project>, milestone: Ref<Milestone> }> = []
  const conHito = tasks.filter((t) => t.milestone !== 0)
  const tareas = await tareasPorPerfexId(
    client,
    conHito.map((t) => t.id)
  )
  const milestoneById = new Map(milestones.map((m) => [m.id, m]))

  for (const task of conHito) {
    const tarea = tareas.get(task.id)
    const perfexMilestone = milestoneById.get(task.milestone)
    if (tarea === undefined || perfexMilestone === undefined) continue

    const space = proyectos.get(perfexMilestone.project_id)
    if (space === undefined) continue
    const milestone = hitosExistentes.get(claveDeHito(space, toHulyMilestone(perfexMilestone, []).label))
    if (milestone === undefined) continue

    pendingTasks.push({ issueId: tarea.id, space, milestone })
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
  }
  logger.log(`Tareas asociadas a su hito: ${updated}`)
}
