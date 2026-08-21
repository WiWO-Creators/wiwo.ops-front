//
// Migración de los cronómetros de Perfex como registros de tiempo de Tracker.
//
import contact, { type Employee, type Person } from '@hcengineering/contact'
import { type Ref, type TxOperations } from '@hcengineering/core'
import { type Logger, type PerfexReader, type PerfexTimeEntry, tareasPorPerfexId } from '@hcengineering/perfex'
import tracker, { type Issue, type Project, type TimeSpendReport } from '@hcengineering/tracker'

/** Segundos del corte 2026-08-19 16:14:07 America/Santiago. */
export const TIME_ENTRIES_CUTOFF = Date.parse('2026-08-19T20:14:07.000Z') / 1000
/** Un cronómetro abierto no puede atribuir más de media jornada. */
export const MAX_OPEN_TIMER_SECONDS = 12 * 60 * 60
const QUERY_BATCH = 500

type TimeSpendReportWithPerfexTimer = TimeSpendReport & { perfexTimerId?: number }

export interface TimeEntriesOptions {
  dryRun: boolean
  peopleByStaffId: Record<string, Ref<Person>>
}

export interface PlannedTimeEntry {
  entry: PerfexTimeEntry
  task: { id: Ref<Issue>; space: Ref<Project> }
  startTime: number
  endTime: number
  closedSynthetic: boolean
}

/** Resultado de normalizar una fila del board, o el motivo por el que no se puede importar. */
export function normalizeTimeEntry(
  entry: PerfexTimeEntry
): Pick<PlannedTimeEntry, 'startTime' | 'endTime' | 'closedSynthetic'> | undefined {
  const startTime = Number(entry.start_time)
  if (!Number.isInteger(startTime) || startTime <= 0) return undefined

  if (entry.end_time === null) {
    const endTime = Math.min(startTime + MAX_OPEN_TIMER_SECONDS, TIME_ENTRIES_CUTOFF)
    return endTime > startTime ? { startTime, endTime, closedSynthetic: true } : undefined
  }

  const endTime = Number(entry.end_time)
  if (!Number.isInteger(endTime) || endTime < startTime) return undefined
  return { startTime, endTime, closedSynthetic: false }
}

/** Clave estable de un timer dentro de su tarea padre. */
export function timeEntryKey(parentId: Ref<Issue>, timerId: number): string {
  return `${parentId}:${timerId}`
}

/** Separa timers pendientes de los que carecen de padre, son inválidos o ya existen. */
export function planTimeEntries(
  entries: PerfexTimeEntry[],
  tasks: Map<number, { id: Ref<Issue>; space: Ref<Project> }>,
  existing: Set<string>
): { pending: PlannedTimeEntry[]; missingParent: PerfexTimeEntry[]; invalid: PerfexTimeEntry[] } {
  const pending: PlannedTimeEntry[] = []
  const missingParent: PerfexTimeEntry[] = []
  const invalid: PerfexTimeEntry[] = []

  for (const entry of entries) {
    const normalized = normalizeTimeEntry(entry)
    if (normalized === undefined) {
      invalid.push(entry)
      continue
    }
    const task = tasks.get(entry.task_id)
    if (task === undefined) {
      missingParent.push(entry)
      continue
    }
    if (!existing.has(timeEntryKey(task.id, entry.id))) pending.push({ entry, task, ...normalized })
  }
  return { pending, missingParent, invalid }
}

/** Preserva la nota y hace explícito un cierre creado para un cronómetro abandonado. */
export function timeEntryDescription(entry: PerfexTimeEntry, closedSynthetic: boolean): string {
  const note = entry.note?.trim() ?? ''
  if (!closedSynthetic) return note
  const annotation =
    'Timer abierto en Perfex al corte; cerrado sintéticamente con un máximo de 12 h. Probablemente quedó abierto.'
  return note === '' ? annotation : `${note}\n\n${annotation}`
}

/** Crea los registros de tiempo históricos del board sin duplicar corridas anteriores. */
export async function importTimeEntries(
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: TimeEntriesOptions
): Promise<void> {
  const entries = await perfex.getTimeEntries()
  const open = entries.filter((entry) => entry.end_time === null).length
  logger.log(
    `Tiempo en el board: ${entries.length} timer(s), ${entries.length - open} cerrados y ${open} abiertos` +
      (options.dryRun ? ' (simulado)' : '')
  )
  if (options.dryRun || entries.length === 0) return

  const tasks = await tareasPorPerfexId(
    client,
    entries.map((entry) => entry.task_id)
  )
  const existing = await existingTimeEntries(
    client,
    [...tasks.values()].map((task) => task.id),
    entries.map((entry) => entry.id)
  )
  const { pending, missingParent, invalid } = planTimeEntries(entries, tasks, existing)
  reportMissingParents(logger, missingParent)
  reportInvalidEntries(logger, invalid)
  logger.log(`Registros de tiempo a crear: ${pending.length} de ${entries.length}`)
  if (pending.length === 0) return

  const employees = await ensureEmployees(client, pending, options.peopleByStaffId)
  const missingPeople = new Set<number>()
  let created = 0
  let failed = 0
  for (const planned of pending) {
    const employee = employees.get(planned.entry.staff_id)
    if (employee === undefined) missingPeople.add(planned.entry.staff_id)
    try {
      await client.addCollection(
        tracker.class.TimeSpendReport,
        planned.task.space,
        planned.task.id,
        tracker.class.Issue,
        'reports',
        {
          employee: employee ?? null,
          date: planned.startTime * 1000,
          value: (planned.endTime - planned.startTime) / 3600,
          description: timeEntryDescription(planned.entry, planned.closedSynthetic),
          perfexTimerId: planned.entry.id
        }
      )
      created++
    } catch (err: any) {
      logger.error(`Timer ${planned.entry.id}: ${err.message}`)
      failed++
    }
  }
  reportMissingPeople(logger, missingPeople)
  logger.log(`Registros de tiempo creados: ${created} de ${pending.length}`)
  if (failed > 0) logger.error(`Quedaron ${failed} timer(s) pendientes; repetir la etapa los reintenta`)
}

/** Crea sólo los mixins Employee necesarios para reportar los timers pendientes. */
async function ensureEmployees(
  client: TxOperations,
  entries: PlannedTimeEntry[],
  peopleByStaffId: Record<string, Ref<Person>>
): Promise<Map<number, Ref<Employee>>> {
  const peopleByStaff = new Map<number, Ref<Person>>()
  for (const { entry } of entries) {
    const person = peopleByStaffId[entry.staff_id]
    if (person !== undefined) peopleByStaff.set(entry.staff_id, person)
  }
  const people = [...new Set(peopleByStaff.values())]
  const employees = new Set(
    (
      await client.findAll<Employee>(contact.mixin.Employee, {
        _id: { $in: people as Array<Ref<Employee>> }
      })
    ).map((employee) => employee._id)
  )
  for (const person of people) {
    if (employees.has(person as Ref<Employee>)) continue
    await client.createMixin(person, contact.class.Person, contact.space.Contacts, contact.mixin.Employee, {
      active: true,
      role: 'USER'
    })
    employees.add(person as Ref<Employee>)
  }

  const resolved = new Map<number, Ref<Employee>>()
  for (const [staffId, person] of peopleByStaff) resolved.set(staffId, person as Ref<Employee>)
  return resolved
}

/** Anclas de los timers ya creados bajo las tareas del workspace. */
async function existingTimeEntries(
  client: TxOperations,
  taskIds: Array<Ref<Issue>>,
  timerIds: number[]
): Promise<Set<string>> {
  const existing = new Set<string>()
  const tasks = [...new Set(taskIds)]
  const timers = [...new Set(timerIds)]
  for (let i = 0; i < tasks.length; i += QUERY_BATCH) {
    const reports = await client.findAll<TimeSpendReportWithPerfexTimer>(
      tracker.class.TimeSpendReport,
      { attachedTo: { $in: tasks.slice(i, i + QUERY_BATCH) }, perfexTimerId: { $in: timers } },
      { projection: { _id: 1, attachedTo: 1, perfexTimerId: 1 } }
    )
    for (const report of reports) {
      if (report.perfexTimerId !== undefined) existing.add(timeEntryKey(report.attachedTo, report.perfexTimerId))
    }
  }
  return existing
}

/** Informa timers cuyo padre aún no fue migrado a este workspace. */
function reportMissingParents(logger: Logger, entries: PerfexTimeEntry[]): void {
  if (entries.length === 0) return
  const tasks = [...new Set(entries.map((entry) => entry.task_id))]
  logger.error(
    `${entries.length} timer(s) de ${tasks.length} tarea(s) no tienen padre en este workspace: ${tasks.join(', ')}. ` +
      'Se omiten y una segunda corrida los retomará.'
  )
}

/** Informa filas que no tienen un rango de tiempo válido. */
function reportInvalidEntries(logger: Logger, entries: PerfexTimeEntry[]): void {
  if (entries.length === 0) return
  logger.error(`Timer(s) con tiempo inválido, omitidos: ${entries.map((entry) => entry.id).join(', ')}`)
}

/** Informa autores sin persona resoluble, cuyos registros se conservaron sin empleado. */
function reportMissingPeople(logger: Logger, staffIds: Set<number>): void {
  if (staffIds.size === 0) return
  logger.error(
    `${staffIds.size} autor(es) de tiempo sin persona en ops: ${[...staffIds].join(', ')}. ` +
      'Sus registros se crearon sin empleado.'
  )
}
