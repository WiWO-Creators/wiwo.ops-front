//
// Cerrar los proyectos: sólo los ve quien tiene tareas ahí.
//
// Es la operación inversa de `abrir`. Recorta los miembros de cada proyecto a quienes tienen una
// tarea asignada o creada en él, suma a los administradores del tipo de proyecto, deja el proyecto
// privado y apaga el "se suman solos", para que quien entre al workspace más adelante no vuelva a
// caer dentro de todos los proyectos.
//
import core, {
  type AccountUuid,
  type PersonId,
  type Ref,
  type SpaceType,
  type TxOperations
} from '@hcengineering/core'
import contact, { formatName, type Person } from '@hcengineering/contact'
import tracker, { type Project } from '@hcengineering/tracker'

import { type Logger } from './import'

export interface CloseOptions {
  /** Si es true no escribe nada: sólo informa qué cambiaría. */
  dryRun: boolean
}

/** Quiénes se quedan en un proyecto y quiénes salen. */
export interface Membership {
  quedan: AccountUuid[]
  salen: AccountUuid[]
}

/**
 * Decide quiénes son los miembros de un proyecto a partir de sus tareas.
 *
 * Queda quien tiene una tarea ahí —asignada o creada por él— y todo administrador del tipo de
 * proyecto, tenga tareas o no. Quien tiene tareas y no era miembro entra; el resto sale.
 *
 * @param members miembros actuales del proyecto.
 * @param conTareas cuentas con al menos una tarea asignada o creada en el proyecto.
 * @param admins cuentas del `ProjectType`, que quedan siempre.
 */
export function calcularMiembros (members: AccountUuid[], conTareas: AccountUuid[], admins: AccountUuid[]): Membership {
  const quedan = [...new Set([...conTareas, ...admins])]
  return { quedan, salen: members.filter((m) => !quedan.includes(m)) }
}

/** Cuentas del workspace indexadas por persona y por identidad social, para resolver las tareas. */
interface Cuentas {
  porPersona: Map<Ref<Person>, AccountUuid>
  porSocialId: Map<PersonId, AccountUuid>
  nombres: Map<AccountUuid, string>
}

/**
 * Arma los índices de cuentas del workspace.
 *
 * `assignee` es una referencia a la persona y `createdBy` una identidad social, así que hacen falta
 * los dos caminos para llegar a la cuenta.
 */
async function cargarCuentas (client: TxOperations): Promise<Cuentas> {
  const porPersona = new Map<Ref<Person>, AccountUuid>()
  const nombres = new Map<AccountUuid, string>()
  for (const employee of await client.findAll(contact.mixin.Employee, {})) {
    if (employee.personUuid === undefined) continue
    porPersona.set(employee._id, employee.personUuid)
    nombres.set(employee.personUuid, formatName(employee.name))
  }

  const porSocialId = new Map<PersonId, AccountUuid>()
  for (const socialId of await client.findAll(contact.class.SocialIdentity, {})) {
    const account = porPersona.get(socialId.attachedTo)
    if (account !== undefined) porSocialId.set(socialId._id, account)
  }

  return { porPersona, porSocialId, nombres }
}

/** Cuentas con al menos una tarea asignada o creada en el proyecto. */
async function getCuentasConTareas (
  client: TxOperations,
  project: Ref<Project>,
  cuentas: Cuentas
): Promise<AccountUuid[]> {
  const issues = await client.findAll(
    tracker.class.Issue,
    { space: project },
    { projection: { _id: 1, assignee: 1, createdBy: 1 } }
  )

  const result = new Set<AccountUuid>()
  for (const issue of issues) {
    const asignado = issue.assignee != null ? cuentas.porPersona.get(issue.assignee) : undefined
    if (asignado !== undefined) result.add(asignado)
    const creador = issue.createdBy != null ? cuentas.porSocialId.get(issue.createdBy) : undefined
    if (creador !== undefined) result.add(creador)
  }
  return [...result]
}

/**
 * Recorta los miembros de cada proyecto a quienes tienen tareas ahí y lo deja privado.
 *
 * @returns cuántos proyectos se modificaron.
 * @throws si algún proyecto quedaría privado y sin ningún miembro: nadie podría verlo, ni siquiera
 *   para arreglarlo. En ese caso no se escribe nada, ni siquiera en los demás proyectos.
 */
export async function closeProjects (client: TxOperations, logger: Logger, options: CloseOptions): Promise<number> {
  const cuentas = await cargarCuentas(client)
  if (cuentas.porPersona.size === 0) {
    throw new Error('No se encontró ninguna persona con cuenta en el workspace')
  }

  const spaceTypes = await client.findAll(core.class.SpaceType, {})
  const adminsPorTipo = new Map<Ref<SpaceType>, AccountUuid[]>(spaceTypes.map((t) => [t._id, t.members ?? []]))

  const projects = await client.findAll(tracker.class.Project, {})
  logger.log(`${projects.length} proyectos, ${cuentas.porPersona.size} personas con cuenta`)

  const plan: Array<{ project: Project, membership: Membership }> = []
  for (const project of projects) {
    const conTareas = await getCuentasConTareas(client, project._id, cuentas)
    const admins = adminsPorTipo.get(project.type) ?? []
    plan.push({ project, membership: calcularMiembros(project.members, conTareas, admins) })
  }

  const vacios = plan.filter((p) => p.membership.quedan.length === 0)
  if (vacios.length > 0) {
    throw new Error(
      `Estos proyectos quedarían privados y sin ningún miembro, así que nadie podría verlos: ${vacios
        .map((v) => v.project.name)
        .join(', ')}. Sumá administradores al tipo de proyecto o asigná sus tareas antes de cerrar.`
    )
  }

  const nombre = (uuid: AccountUuid): string => cuentas.nombres.get(uuid) ?? uuid

  let changed = 0
  for (const { project, membership } of plan) {
    const yaEstaba =
      membership.salen.length === 0 &&
      membership.quedan.length === project.members.length &&
      project.private &&
      project.autoJoin !== true
    if (yaEstaba) continue

    logger.log(`  ${project.name}: quedan ${membership.quedan.length}, salen ${membership.salen.length}`)
    for (const uuid of membership.salen) {
      logger.log(`    sale ${nombre(uuid)}`)
    }

    if (!options.dryRun) {
      await client.update(project, {
        members: membership.quedan,
        private: true,
        autoJoin: false
      })
    }
    changed++
  }

  const conRoles = projects.filter((p) => (p.autoJoinForRoles?.length ?? 0) > 0)
  if (conRoles.length > 0) {
    logger.error(
      `Ojo: ${conRoles.length} proyectos siguen sumando gente sola por rol (autoJoinForRoles) y hay que ` +
        `revisarlos a mano: ${conRoles.map((p) => p.name).join(', ')}`
    )
  }

  logger.log(`Proyectos cerrados: ${changed}${options.dryRun ? ' (simulado)' : ''}`)
  return changed
}
