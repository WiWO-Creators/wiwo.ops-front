//
// Repartir los permisos de cada proyecto a partir del CSV del board.
//
// El focal es el dueño del proyecto: entra como owner, como miembro y con el rol Focal, que le
// permite crear, editar y borrar tareas y administrar el proyecto. Las demás personas asociadas
// quedan anotadas en `asociados`, sin acceso: el focal decide después a quién le abre el proyecto y
// con qué rol. Para que los roles se hagan valer, el proyecto queda `restricted` y privado.
//
import core, {
  type AccountUuid,
  type Class,
  type Permission,
  type Ref,
  type Role,
  type RolesAssignment,
  SocialIdType,
  type Space,
  type SpaceType,
  type TxOperations
} from '@hcengineering/core'
import contact, { formatName, type Person } from '@hcengineering/contact'
import { createSpaceTypeRole } from '@hcengineering/setting'
import tracker, { ROL_EQUIPO, ROL_FOCAL, ROL_RESTRINGIDO, type Project } from '@hcengineering/tracker'
import { parse } from 'csv-parse/sync'

import { type Logger } from './import'

export interface PermisosOptions {
  /** Si es true no escribe nada: sólo informa qué cambiaría. */
  dryRun: boolean
}

/** Una fila del CSV, ya partida. */
export interface FilaCsv {
  projectId: number
  proyecto: string
  focal: string[]
  personas: string[]
}

/** Reparto de accesos de un proyecto. */
export interface Accesos {
  owners: AccountUuid[]
  members: AccountUuid[]
  /** Miembros que no son focal: ven todas las tareas y las trabajan, pero no administran. */
  equipo: AccountUuid[]
  asociados: AccountUuid[]
}

/** Correos que el CSV nombra y el workspace no conoce. */
export interface Faltantes {
  sinFocal: string[]
  sinProyecto: string[]
  correosDesconocidos: string[]
  nombresAmbiguos: string[]
}

const COLUMNAS = ['project_id', 'proyecto', 'focal', 'personas_asociadas_board']

/** Saca el correo de `Nombre Apellido <correo@dominio>`; si no hay, devuelve undefined. */
export function extraerCorreo (persona: string): string | undefined {
  const match = /<([^>]+)>/.exec(persona)
  const correo = (match?.[1] ?? '').trim().toLowerCase()
  return correo !== '' ? correo : undefined
}

/** Parte una celda de personas separadas por `|` y devuelve sus correos, sin repetidos. */
export function correosDeCelda (celda: string): string[] {
  const correos = celda
    .split('|')
    .map((p) => extraerCorreo(p))
    .filter((c): c is string => c !== undefined)
  return [...new Set(correos)]
}

/**
 * Parte el CSV del board en filas utilizables.
 *
 * @param contenido el archivo entero, con su encabezado.
 * @throws si falta alguna de las columnas que se usan.
 */
export function parsearCsv (contenido: string): FilaCsv[] {
  const filas: string[][] = parse(contenido, { bom: true, relaxColumnCount: true, skipEmptyLines: true })
  if (filas.length === 0) {
    throw new Error('El CSV está vacío')
  }

  const encabezado = filas[0].map((c) => c.trim())
  const faltan = COLUMNAS.filter((c) => !encabezado.includes(c))
  if (faltan.length > 0) {
    throw new Error(`Al CSV le faltan columnas: ${faltan.join(', ')}`)
  }

  const indice = (columna: string): number => encabezado.indexOf(columna)
  const resultado: FilaCsv[] = []
  for (const fila of filas.slice(1)) {
    const projectId = Number.parseInt(fila[indice('project_id')] ?? '', 10)
    if (Number.isNaN(projectId)) continue

    resultado.push({
      projectId,
      proyecto: (fila[indice('proyecto')] ?? '').trim(),
      focal: correosDeCelda(fila[indice('focal')] ?? ''),
      personas: correosDeCelda(fila[indice('personas_asociadas_board')] ?? '')
    })
  }

  return resultado
}

/**
 * Reparte los accesos de un proyecto entre focales, administradores y asociados.
 *
 * El focal entra como dueño y miembro; los administradores del tipo de proyecto entran como
 * miembros, porque son los que tienen que poder ver todo; el resto queda asociado sin acceso. Nadie
 * que tenga acceso queda además como asociado, aunque el CSV lo liste en las dos columnas.
 *
 * @param focales cuentas de los focales del proyecto.
 * @param personas cuentas de todas las personas asociadas en el board.
 * @param admins cuentas cargadas en el tipo de proyecto, que ven todos los proyectos.
 */
export function calcularAccesos (
  focales: AccountUuid[],
  personas: AccountUuid[],
  admins: AccountUuid[] = []
): Accesos {
  const owners = [...new Set(focales)]
  const members = [...new Set([...owners, ...admins])]
  const conAcceso = new Set(members)

  return {
    owners,
    members,
    equipo: members.filter((m) => !owners.includes(m)),
    asociados: [...new Set(personas)].filter((p) => !conAcceso.has(p))
  }
}

/** Cuentas del workspace por correo, más sus nombres para el informe. */
export interface Cuentas {
  porCorreo: Map<string, AccountUuid>
  nombres: Map<AccountUuid, string>
}

/**
 * Indexa las cuentas del workspace por correo.
 *
 * El correo de acceso es una identidad social de tipo EMAIL colgada de la persona; el empleado es
 * el que tiene la cuenta (`personUuid`).
 */
export async function cargarCuentas (client: TxOperations): Promise<Cuentas> {
  const porPersona = new Map<Ref<Person>, AccountUuid>()
  const nombres = new Map<AccountUuid, string>()
  for (const employee of await client.findAll(contact.mixin.Employee, {})) {
    if (employee.personUuid === undefined) continue
    porPersona.set(employee._id, employee.personUuid)
    nombres.set(employee.personUuid, formatName(employee.name))
  }

  const porCorreo = new Map<string, AccountUuid>()
  for (const socialId of await client.findAll(contact.class.SocialIdentity, { type: SocialIdType.EMAIL })) {
    const account = porPersona.get(socialId.attachedTo)
    if (account !== undefined) porCorreo.set(socialId.value.trim().toLowerCase(), account)
  }

  return { porCorreo, nombres }
}

/**
 * Empareja cada fila del CSV con su proyecto de Huly.
 *
 * El ancla es `perfexId`, que deja puesto la importación. Si el proyecto no lo tiene todavía se cae
 * al nombre exacto, y si ese nombre se repite se lo deja afuera: en el board hay veinte nombres
 * duplicados y elegir uno al azar sería repartir permisos en el proyecto equivocado.
 */
function emparejar (
  filas: FilaCsv[],
  projects: Project[]
): { pares: Array<{ fila: FilaCsv, project: Project }>, sinProyecto: string[], ambiguos: string[] } {
  const porPerfexId = new Map<number, Project>()
  const porNombre = new Map<string, Project[]>()
  for (const project of projects) {
    if (project.perfexId !== undefined) porPerfexId.set(project.perfexId, project)
    const mismoNombre = porNombre.get(project.name) ?? []
    mismoNombre.push(project)
    porNombre.set(project.name, mismoNombre)
  }

  const pares: Array<{ fila: FilaCsv, project: Project }> = []
  const sinProyecto: string[] = []
  const ambiguos: string[] = []
  for (const fila of filas) {
    const porId = porPerfexId.get(fila.projectId)
    if (porId !== undefined) {
      pares.push({ fila, project: porId })
      continue
    }

    const mismoNombre = porNombre.get(fila.proyecto) ?? []
    if (mismoNombre.length === 1) {
      pares.push({ fila, project: mismoNombre[0] })
    } else if (mismoNombre.length > 1) {
      ambiguos.push(`${fila.proyecto} (id ${fila.projectId})`)
    } else {
      sinProyecto.push(`${fila.proyecto} (id ${fila.projectId})`)
    }
  }

  return { pares, sinProyecto, ambiguos }
}

/** Permisos de cada rol. El focal manda; los otros dos trabajan las tareas que ven. */
function permisosDelRol (nombre: string): Ref<Permission>[] {
  const trabajar = [tracker.permission.CreateIssue, tracker.permission.UpdateIssue]
  if (nombre !== ROL_FOCAL) return trabajar

  return [...trabajar, tracker.permission.DeleteIssue, core.permission.UpdateSpace, core.permission.ArchiveSpace]
}

/**
 * Devuelve los tres roles del tipo de proyecto, creando los que falten.
 *
 * Se los busca por nombre y no por id porque cada tipo de proyecto tiene los suyos: el tipo que
 * crea la migración no es el mismo que el de los proyectos hechos a mano.
 */
async function asegurarRoles (
  client: TxOperations,
  spaceType: SpaceType,
  logger: Logger,
  dryRun: boolean
): Promise<Map<string, Ref<Role>>> {
  const existentes = await client.findAll(core.class.Role, { attachedTo: spaceType._id })
  const porNombre = new Map<string, Ref<Role>>(existentes.map((r: Role) => [r.name, r._id]))

  for (const nombre of [ROL_FOCAL, ROL_EQUIPO, ROL_RESTRINGIDO]) {
    if (porNombre.has(nombre)) continue

    logger.log(`  falta el rol ${nombre} en el tipo de proyecto ${spaceType.name}: se crea`)
    if (dryRun) continue

    const roleId = await createSpaceTypeRole(client, spaceType, {
      name: nombre,
      permissions: permisosDelRol(nombre),
      collaboratorsOnly: nombre === ROL_RESTRINGIDO ? true : undefined
    })
    porNombre.set(nombre, roleId)
  }

  return porNombre
}

/**
 * Aplica al workspace el reparto de permisos que dice el CSV.
 *
 * Valida todos los proyectos antes de escribir en ninguno: si algo no cierra —un proyecto sin
 * focal, un correo que el workspace no conoce, un nombre ambiguo— informa y no toca nada.
 *
 * @returns cuántos proyectos se modificaron.
 * @throws si el CSV no se puede usar tal como está.
 */
export async function aplicarPermisos (
  client: TxOperations,
  logger: Logger,
  csv: string,
  options: PermisosOptions
): Promise<number> {
  const filas = parsearCsv(csv)
  const cuentas = await cargarCuentas(client)
  if (cuentas.porCorreo.size === 0) {
    throw new Error('No se encontró ninguna persona con cuenta en el workspace')
  }

  const projects = await client.findAll(tracker.class.Project, {})
  const { pares, sinProyecto, ambiguos } = emparejar(filas, projects)
  logger.log(`${filas.length} filas en el CSV, ${projects.length} proyectos en el workspace`)

  const faltantes: Faltantes = {
    sinFocal: [],
    sinProyecto,
    correosDesconocidos: [],
    nombresAmbiguos: ambiguos
  }

  const spaceTypes = new Map<Ref<SpaceType>, SpaceType>(
    (await client.findAll(core.class.SpaceType, {})).map((t: SpaceType) => [t._id, t])
  )

  const desconocidos = new Set<string>()
  const resolver = (correos: string[]): AccountUuid[] => {
    const cuentasResueltas: AccountUuid[] = []
    for (const correo of correos) {
      const account = cuentas.porCorreo.get(correo)
      if (account === undefined) desconocidos.add(correo)
      else cuentasResueltas.push(account)
    }
    return cuentasResueltas
  }

  const rolesPorTipo = new Map<Ref<SpaceType>, Map<string, Ref<Role>>>()
  const plan: Array<{
    project: Project
    accesos: Accesos
    targetClass: Ref<Class<Space>>
    roles: Map<string, Ref<Role>>
  }> = []
  for (const { fila, project } of pares) {
    const focales = resolver(fila.focal)
    if (focales.length === 0) {
      faltantes.sinFocal.push(`${fila.proyecto} (id ${fila.projectId})`)
      continue
    }

    const spaceType = spaceTypes.get(project.type)
    if (spaceType === undefined) {
      throw new Error(`El proyecto ${project.name} apunta a un tipo de proyecto que no existe: ${project.type}`)
    }

    let roles = rolesPorTipo.get(spaceType._id)
    if (roles === undefined) {
      roles = await asegurarRoles(client, spaceType, logger, options.dryRun)
      rolesPorTipo.set(spaceType._id, roles)
    }

    plan.push({
      project,
      accesos: calcularAccesos(focales, resolver(fila.personas), spaceType.members ?? []),
      targetClass: spaceType.targetClass,
      roles
    })
  }
  faltantes.correosDesconocidos = [...desconocidos]

  informarFaltantes(logger, faltantes)
  if (plan.length === 0) {
    throw new Error('Ninguna fila del CSV se pudo aplicar; revisá el informe de arriba')
  }

  let changed = 0
  for (const { project, accesos, targetClass, roles } of plan) {
    const nombres = accesos.owners.map((o) => cuentas.nombres.get(o) ?? o).join(', ')
    logger.log(
      `  ${project.name}: focal ${nombres}; ${accesos.members.length} miembros; ` +
        `${accesos.asociados.length} asociados sin acceso`
    )

    if (!options.dryRun) {
      await client.update(project, {
        owners: accesos.owners,
        members: accesos.members,
        asociados: accesos.asociados,
        private: true,
        restricted: true,
        autoJoin: false
      })

      // El rol restringido queda vacío a propósito: el reparto inicial no le da acceso a nadie más
      // que al focal y a los administradores del tipo de proyecto, y es el focal quien después
      // decide a quién abre el proyecto y con qué alcance.
      const asignacion: RolesAssignment = {}
      for (const [nombre, roleId] of roles) {
        if (nombre === ROL_FOCAL) asignacion[roleId] = accesos.owners
        else if (nombre === ROL_EQUIPO) asignacion[roleId] = accesos.equipo
        else asignacion[roleId] = []
      }
      await client.updateMixin(project._id, tracker.class.Project, core.space.Space, targetClass, asignacion)
    }
    changed++
  }

  logger.log(`Proyectos con permisos repartidos: ${changed}${options.dryRun ? ' (simulado)' : ''}`)
  return changed
}

/** Deja por escrito todo lo que el CSV nombra y el workspace no pudo resolver. */
function informarFaltantes (logger: Logger, faltantes: Faltantes): void {
  if (faltantes.sinFocal.length > 0) {
    logger.error(
      `${faltantes.sinFocal.length} proyectos no tienen focal en el CSV y quedan sin tocar: ` +
        faltantes.sinFocal.join(', ')
    )
  }
  if (faltantes.sinProyecto.length > 0) {
    logger.error(
      `${faltantes.sinProyecto.length} filas del CSV no tienen proyecto en el workspace: ` +
        faltantes.sinProyecto.join(', ')
    )
  }
  if (faltantes.nombresAmbiguos.length > 0) {
    logger.error(
      `${faltantes.nombresAmbiguos.length} filas tienen el nombre repetido en el workspace y no se puede ` +
        `saber cuál es: ${faltantes.nombresAmbiguos.join(', ')}. Importá los proyectos con perfexId.`
    )
  }
  if (faltantes.correosDesconocidos.length > 0) {
    logger.error(
      `${faltantes.correosDesconocidos.length} correos del CSV no tienen cuenta en el workspace: ` +
        faltantes.correosDesconocidos.join(', ')
    )
  }
}
