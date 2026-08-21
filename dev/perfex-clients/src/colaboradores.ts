//
// Migración de los seguidores y los asignados extra del board.
//
// En Perfex una tarea tiene una lista de seguidores (`tbltask_followers`), que sólo reciben avisos,
// y puede tener varios asignados (`tbltask_assigned`), todos al mismo nivel. En Huly el responsable
// es uno solo, y el equivalente de los demás es el colaborador de la tarea: un `core.class.Collaborator`
// colgado del `Issue`.
//
// Un colaborador **no da acceso por sí solo**: no hay ningún trigger sobre `core.class.Collaborator`
// y la lectura se sigue filtrando por espacio. Esta pasada no toca `members`, `owners` ni los roles;
// es el focal quien decide a quién abre el proyecto. Lo que deja listo es que, cuando el focal le da
// el rol `Restringido` a alguien, esa persona vea de entrada las tareas que en el board seguía o
// tenía asignadas.
//
import core, { type AccountUuid, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import {
  tareasPorPerfexId,
  type Logger,
  type PerfexFollower,
  type PerfexReader,
  type PerfexStaff,
  type PerfexTask
} from '@hcengineering/perfex'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import { cargarCuentas } from './permisos'
import { COMPLETED_TASK_STATUS } from './tareas'

/** Documentos por tanda al escribir, igual que en el resto de la migración. */
const UPDATE_BATCH = 25
/** Ids por consulta al preguntarle a Huly por documentos ya existentes. */
const QUERY_BATCH = 500

/** Un colaborador a dar de alta: la tarea del board y la persona del staff. */
export interface ColaboradorPlanificado {
  taskid: number
  staffid: number
}

export interface ColaboradoresOptions {
  /** Si es true no escribe nada en Huly: sólo informa qué haría. */
  dryRun: boolean
  /**
   * Si es true migra también los colaboradores de las tareas ya completadas en el board. Por
   * defecto quedan fuera: son las tres cuartas partes del volumen y sólo agregan ruido a la bandeja.
   */
  includeClosedTasks: boolean
  /** Se llama tras cada tanda escrita, para poder informar avance. */
  onProgress?: () => void
}

/**
 * Arma la lista de colaboradores a dar de alta a partir de las tareas y los seguidores del board.
 *
 * Deja fuera al asignado principal, que Huly ya da de alta solo al crear la tarea
 * (`ClassCollaborators` de `Issue` declara `fields: ['createdBy', 'assignee']`), los seguidores de
 * tareas que no existen en el board y, salvo que se pida lo contrario, todo lo que cuelgue de una
 * tarea completada.
 *
 * @param tasks tareas del board, con sus asignados en el orden en que los devuelve Perfex.
 * @param followers filas de `tbltask_followers`, que pueden venir repetidas.
 * @param options opciones de la corrida; sólo se mira `includeClosedTasks`.
 * @returns los pares (tarea, persona) a dar de alta, sin repetidos.
 */
export function planificarColaboradores (
  tasks: PerfexTask[],
  followers: PerfexFollower[],
  options: Pick<ColaboradoresOptions, 'includeClosedTasks'>
): ColaboradorPlanificado[] {
  const tareasPorId = new Map<number, PerfexTask>()
  for (const task of tasks) {
    if (options.includeClosedTasks || task.status !== COMPLETED_TASK_STATUS) tareasPorId.set(task.id, task)
  }

  const candidatos = new Map<number, Set<number>>()
  const sumar = (taskid: number, staffid: number): void => {
    const task = tareasPorId.get(taskid)
    if (task === undefined) return
    // El asignado principal ya es colaborador: darlo de alta otra vez duplicaría la fila.
    if (task.assignees.length > 0 && task.assignees[0] === staffid) return

    const staffDeLaTarea = candidatos.get(taskid) ?? new Set<number>()
    staffDeLaTarea.add(staffid)
    candidatos.set(taskid, staffDeLaTarea)
  }

  for (const follower of followers) sumar(follower.taskid, follower.staffid)
  for (const task of tasks) {
    for (const staffid of task.assignees.slice(1)) sumar(task.id, staffid)
  }

  const plan: ColaboradorPlanificado[] = []
  for (const [taskid, staffIds] of candidatos) {
    for (const staffid of staffIds) plan.push({ taskid, staffid })
  }
  return plan
}

/**
 * Da de alta en Huly los colaboradores de las tareas ya migradas.
 *
 * Las personas del staff que todavía no tienen cuenta en el workspace —porque nunca entraron— se
 * informan y se dejan para una segunda pasada; no se crea nada por ellas.
 *
 * @param client cliente de Huly ya autenticado contra el workspace destino.
 * @param perfex lector del board.
 * @throws si no hay ninguna persona con cuenta en el workspace, porque entonces no se puede escribir nada.
 */
export async function importColaboradores (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ColaboradoresOptions
): Promise<void> {
  const avisarAvance = options.onProgress ?? ((): void => {})
  const tasks = await perfex.getTasks()
  const followers = await perfex.getFollowers()
  const plan = planificarColaboradores(tasks, followers, options)

  const personas = new Set(plan.map((c) => c.staffid))
  logger.log(
    `Colaboradores a migrar: ${plan.length} sobre ${new Set(plan.map((c) => c.taskid)).size} tarea(s), ` +
      `${personas.size} persona(s) del staff` +
      (options.includeClosedTasks ? ', incluidas las tareas cerradas' : ', sólo tareas abiertas') +
      (options.dryRun ? ' (simulado)' : '')
  )
  if (options.dryRun || plan.length === 0) return

  // 1. staffid → cuenta de ops, por correo. El staff que nunca entró al workspace no tiene cuenta.
  const cuentas = await cargarCuentas(client)
  if (cuentas.porCorreo.size === 0) {
    throw new Error('No se encontró ninguna persona con cuenta en el workspace')
  }
  const staffById = new Map<number, PerfexStaff>((await perfex.getStaff()).map((s) => [s.staffid, s]))
  const sinCuenta = new Set<string>()
  const cuentaDe = (staffid: number): AccountUuid | undefined => {
    const staff = staffById.get(staffid)
    const correo = staff?.email?.trim().toLowerCase() ?? ''
    if (correo === '') {
      sinCuenta.add(`staffid ${staffid} (sin correo en el board)`)
      return undefined
    }
    const account = cuentas.porCorreo.get(correo)
    if (account === undefined) sinCuenta.add(correo)
    return account
  }

  // 2. Las tareas migradas de este workspace, con su espacio: el Collaborator cuelga del Issue.
  const tareas = await tareasPorPerfexId(
    client,
    plan.map((c) => c.taskid)
  )
  logger.log(`Tareas encontradas en este workspace: ${tareas.size}`)
  if (tareas.size === 0) return

  const pendientesPorClave = new Map<string, { tarea: { id: Ref<Issue>, space: Ref<Project> }, collaborator: AccountUuid }>()
  for (const { taskid, staffid } of plan) {
    const tarea = tareas.get(taskid)
    if (tarea === undefined) continue
    const collaborator = cuentaDe(staffid)
    if (collaborator === undefined) continue
    pendientesPorClave.set(`${tarea.id}:${collaborator}`, { tarea, collaborator })
  }
  const pendientes = [...pendientesPorClave.values()]
  informarSinCuenta(logger, sinCuenta)

  // 3. Los que ya estén puestos se saltean: la tabla de colaboradores no tiene índice único, así que
  //    la única defensa contra los duplicados es no escribirlos.
  const yaPuestos = await colaboradoresExistentes(
    client,
    pendientes.map((p) => p.tarea.id)
  )
  const faltantes = pendientes.filter((p) => !yaPuestos.has(`${p.tarea.id}:${p.collaborator}`))
  logger.log(`Colaboradores a escribir: ${faltantes.length} de ${pendientes.length}`)

  let escritos = 0
  for (let i = 0; i < faltantes.length; i += UPDATE_BATCH) {
    const batch = faltantes.slice(i, i + UPDATE_BATCH)
    await Promise.all(
      batch.map(async ({ tarea, collaborator }) => {
        await client.addCollection(
          core.class.Collaborator,
          tarea.space,
          tarea.id,
          tracker.class.Issue,
          'collaborators',
          { collaborator }
        )
      })
    )
    escritos += batch.length
    logger.log(`  ... ${escritos} de ${faltantes.length} colaboradores puestos`)
    avisarAvance()
  }
  logger.log(`Colaboradores puestos: ${escritos}`)
}

/** Deja por escrito el staff que la pasada no pudo resolver a una cuenta del workspace. */
function informarSinCuenta (logger: Logger, sinCuenta: Set<string>): void {
  if (sinCuenta.size === 0) return
  logger.error(
    `${sinCuenta.size} persona(s) del staff sin cuenta en ops: sus colaboraciones no se migran. ` +
      `Entran solas en una segunda corrida, después de que ingresen por primera vez: ${[...sinCuenta].join(', ')}`
  )
}

/** Claves `tarea:cuenta` de los colaboradores que ya existen en Huly. */
async function colaboradoresExistentes (client: TxOperations, tareas: Array<Ref<Doc>>): Promise<Set<string>> {
  const puestos = new Set<string>()
  const lista = [...new Set(tareas)]
  for (let i = 0; i < lista.length; i += QUERY_BATCH) {
    // Sin `projection`: en el dominio de colaboradores `attachedTo` y `collaborator` son columnas
    // propias de la tabla, no claves del JSON del documento, y la proyección las devuelve vacías.
    // Con ella, la comprobación de duplicados no encuentra nada y la segunda corrida los repite.
    const existentes = await client.findAll(core.class.Collaborator, {
      attachedTo: { $in: lista.slice(i, i + QUERY_BATCH) }
    })
    for (const existente of existentes) puestos.add(`${existente.attachedTo}:${existente.collaborator}`)
  }
  return puestos
}
