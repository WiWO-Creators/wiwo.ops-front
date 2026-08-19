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

/** Código de Perfex para una tarea ya terminada. */
export const COMPLETED_TASK_STATUS = 5

/** Prioridades de Perfex traducidas a las claves de `IssuePriority` de Huly. */
export const TASK_PRIORITIES: Record<number, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent'
}

/** Estados de proyecto de Perfex que corresponden a un proyecto ya cerrado. */
export const CLOSED_PROJECT_STATUSES = new Set([4, 5])

/** Estados de proyecto de Perfex, tal como se ven en el board. */
export const PROJECT_STATUSES: Record<number, string> = {
  1: 'No iniciado',
  2: 'En progreso',
  3: 'En pausa',
  4: 'Terminado',
  5: 'Cancelado'
}

/** Nombre del estado de un proyecto de Perfex; si el código no existe, queda como en progreso. */
export function getProjectStatusName (status: number): string {
  return PROJECT_STATUSES[status] ?? PROJECT_STATUSES[2]
}

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
