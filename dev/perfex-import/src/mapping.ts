//
// Traducción de los códigos de Perfex a los conceptos de Huly.
//
import { type ImportStatus } from '@hcengineering/importer'

/** Estados de tarea de Perfex, con el nombre que llevarán en Huly. */
export const TASK_STATUSES: Record<number, string> = {
  1: 'Sin empezar',
  2: 'En progreso',
  3: 'Testing',
  4: 'Esperando feedback',
  5: 'Completada'
}

/** Orden en que los estados se crean en el tipo de proyecto de Huly. */
export const TASK_STATUS_ORDER: ImportStatus[] = [
  { name: TASK_STATUSES[1] },
  { name: TASK_STATUSES[2] },
  { name: TASK_STATUSES[3] },
  { name: TASK_STATUSES[4] },
  { name: TASK_STATUSES[5] }
]

/** Prioridades de Perfex traducidas a las claves de `IssuePriority` de Huly. */
export const TASK_PRIORITIES: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent'
}

/** Estados de proyecto de Perfex que corresponden a un proyecto ya cerrado. */
export const CLOSED_PROJECT_STATUSES = new Set([4, 5])

/** Nombre del tipo de proyecto que se crea en Huly para los proyectos migrados. */
export const PROJECT_TYPE_NAME = 'Perfex'

/** Nombre del tipo de tarea dentro del tipo de proyecto. */
export const TASK_TYPE_NAME = 'Tarea'

/** Proyecto donde caen las tareas de Perfex que no colgaban de ningún proyecto. */
export const ORPHAN_PROJECT_NAME = 'Sin proyecto (Perfex)'

/** Identificador corto del proyecto de tareas sueltas. */
export const ORPHAN_PROJECT_IDENTIFIER = 'PFX'

export function getStatusName (status: number): string {
  return TASK_STATUSES[status] ?? TASK_STATUSES[1]
}

export function getPriorityName (priority: number): string {
  return TASK_PRIORITIES[priority] ?? 'NoPriority'
}

/**
 * Deriva un identificador corto de proyecto (el prefijo de las tareas, tipo `WEB-12`) a partir
 * del nombre. Toma las iniciales de las primeras palabras y cae al nombre recortado si no
 * alcanzan; quien resuelve las colisiones es `uniqueProjectIdentifier` del importador.
 */
export function buildProjectIdentifier (name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()

  const words = normalized.split(/[^A-Z0-9]+/).filter((w) => w.length > 0)
  if (words.length === 0) return 'PRJ'

  const initials = words
    .slice(0, 4)
    .map((w) => w[0])
    .join('')
  const identifier = initials.length >= 3 ? initials : words[0].slice(0, 5)
  return identifier.slice(0, 5)
}

/**
 * Ambientes destino: cada uno es un workspace de Huly aparte. Se decide por los grupos de
 * cliente de Perfex; el cliente que no tenga ninguno de los grupos listados cae en
 * `sin-clasificar`, para repartirlo después desde la interfaz.
 *
 * El orden importa: hay clientes que están en dos grupos a la vez (por ejemplo MGC HQ y WIWO)
 * y cada cliente tiene que migrarse a un solo ambiente, o sus proyectos aparecerían duplicados.
 * Gana el primero de esta lista, que va del grupo más específico al más general.
 */
export interface Environment {
  /** Clave que se pasa por línea de comandos. */
  id: string
  /** Nombre legible, sólo para los mensajes. */
  label: string
  /** Grupos de cliente de Perfex que pertenecen a este ambiente. */
  groups: string[]
}

export const ENVIRONMENTS: Environment[] = [
  { id: 'wiwo', label: 'WiWO', groups: ['WIWO'] },
  { id: 'palta', label: 'Palta', groups: ['Palta'] },
  {
    id: 'mgc',
    label: 'MGC',
    groups: ['MGC HQ', 'MGC Andina', 'MGC Caribe', 'MGC USA', 'Aima', 'Foundaxis', 'HL', 'iLuk']
  },
  { id: 'sin-clasificar', label: 'Sin clasificar', groups: [] }
]

export function getEnvironment (id: string): Environment {
  const environment = ENVIRONMENTS.find((e) => e.id === id)
  if (environment === undefined) {
    throw new Error(`Ambiente desconocido: ${id}. Válidos: ${ENVIRONMENTS.map((e) => e.id).join(', ')}`)
  }
  return environment
}

/**
 * Devuelve el único ambiente al que va un cliente, según sus grupos de Perfex.
 *
 * Los clientes sin grupo, o con grupos que ningún ambiente reclama, caen en `sin-clasificar`,
 * para que ninguno quede afuera de la migración.
 */
export function resolveEnvironment (clientGroups: string[]): Environment {
  const groups = clientGroups.map((g) => g.trim().toLowerCase()).filter((g) => g !== '')
  const match = ENVIRONMENTS.find(
    (e) => e.groups.length > 0 && e.groups.some((own) => groups.includes(own.toLowerCase()))
  )
  return match ?? ENVIRONMENTS[ENVIRONMENTS.length - 1]
}

/** Decide si un cliente pertenece al ambiente indicado. */
export function belongsToEnvironment (clientGroups: string[], environment: Environment): boolean {
  return resolveEnvironment(clientGroups).id === environment.id
}
