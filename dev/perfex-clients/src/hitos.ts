//
// Traducción de los hitos de Perfex a los hitos de Huly.
//
import { MilestoneStatus } from '@hcengineering/tracker'

import { type PerfexMilestone, type PerfexTask } from './perfex'
import { COMPLETED_TASK_STATUS } from './tareas'

/**
 * Tono (matiz HSL) de cada color de la paleta de avatares de Huly, en el mismo orden que
 * `avatarWhiteColors` de `packages/ui/src/colors.ts`. El índice 0 es el gris "Unassigned" y por eso
 * no participa de la búsqueda: un hito con color elegido nunca debería caer en el gris por defecto.
 *
 * Se copia acá porque `@hcengineering/ui` es un paquete de Svelte y esta herramienta corre en Node.
 */
const PALETTE_HUES = [
  0, 235, 222, 216, 200, 192, 186, 153, 108, 70, 45, 30, 25, 23, 334, 300, 274, 252, 232, 222, 210, 213, 210, 210
]

/** El día en milisegundos, para comparar fechas sin arrastrar la hora. */
const DAY = 24 * 60 * 60 * 1000

/**
 * Convierte una fecha de Perfex (`YYYY-MM-DD`) al timestamp que guarda Huly.
 *
 * @returns null si la fecha viene vacía o no se puede leer.
 */
export function toTimestamp (value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  return Number.isNaN(time) ? null : time
}

/**
 * Pasa un color hexadecimal de Perfex al índice de la paleta de Huly con el tono más parecido.
 *
 * @param hex color tal como lo guarda Perfex (`#03a9f4`), o vacío/nulo si el hito no tiene color.
 * @returns el índice de la paleta, o undefined si no hay color que convertir.
 */
export function toPaletteColor (hex: string | null | undefined): number | undefined {
  if (hex === null || hex === undefined) return undefined
  const clean = hex.trim().replace('#', '')
  if (clean.length !== 3 && clean.length !== 6) return undefined

  const full =
    clean.length === 3
      ? clean
        .split('')
        .map((c) => c + c)
        .join('')
      : clean
  const value = Number.parseInt(full, 16)
  if (Number.isNaN(value)) return undefined

  const hue = toHue((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)

  let best = 1
  let bestDistance = Number.MAX_SAFE_INTEGER
  for (let i = 1; i < PALETTE_HUES.length; i++) {
    const raw = Math.abs(PALETTE_HUES[i] - hue)
    const distance = Math.min(raw, 360 - raw)
    if (distance < bestDistance) {
      bestDistance = distance
      best = i
    }
  }
  return best
}

/** Matiz HSL, en grados, de un color RGB. El gris devuelve 0. */
function toHue (r: number, g: number, b: number): number {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  if (delta === 0) return 0

  let hue: number
  if (max === red) hue = ((green - blue) / delta) % 6
  else if (max === green) hue = (blue - red) / delta + 2
  else hue = (red - green) / delta + 4

  hue *= 60
  return hue < 0 ? hue + 360 : hue
}

/**
 * Deduce en qué estado está un hito, que Perfex no guarda.
 *
 * Completado si todas sus tareas ya lo están —y tiene al menos una—, planificado si todavía no
 * empezó, y en progreso en cualquier otro caso.
 *
 * @param milestone hito de Perfex.
 * @param tasks tareas de Perfex que apuntan a ese hito; puede venir vacío.
 * @param now momento contra el que se compara, para poder probarlo.
 */
export function toMilestoneStatus (
  milestone: PerfexMilestone,
  tasks: PerfexTask[],
  now: number = Date.now()
): MilestoneStatus {
  if (tasks.length > 0 && tasks.every((t) => t.status === COMPLETED_TASK_STATUS)) {
    return MilestoneStatus.Completed
  }
  const start = toTimestamp(milestone.start_date)
  if (start !== null && start > now + DAY) {
    return MilestoneStatus.Planned
  }
  return MilestoneStatus.InProgress
}

/** Datos de un hito de Huly, listos para escribir. */
export interface HulyMilestone {
  label: string
  startDate: number | null
  targetDate: number
  status: MilestoneStatus
  color?: number
}

/**
 * Traduce un hito de Perfex a los campos que espera Huly.
 *
 * @param milestone hito de Perfex.
 * @param tasks tareas de ese hito, para deducir el estado.
 * @param now momento contra el que se compara el estado.
 * @returns los campos del hito de Huly; la descripción y el orden se resuelven aparte porque
 *          necesitan el cliente y el resto de los hitos del proyecto.
 */
export function toHulyMilestone (
  milestone: PerfexMilestone,
  tasks: PerfexTask[],
  now: number = Date.now()
): HulyMilestone {
  const target = toTimestamp(milestone.due_date)
  const start = toTimestamp(milestone.start_date)
  const label = milestone.name.trim() !== '' ? milestone.name.trim() : `Hito ${milestone.id}`

  return {
    label,
    startDate: start,
    // Perfex obliga a poner fecha de entrega; si aun así falta, se cae a la de inicio y, sin
    // ninguna, al momento de la migración, porque Huly la exige.
    targetDate: target ?? start ?? now,
    status: toMilestoneStatus(milestone, tasks, now),
    color: toPaletteColor(milestone.color)
  }
}
