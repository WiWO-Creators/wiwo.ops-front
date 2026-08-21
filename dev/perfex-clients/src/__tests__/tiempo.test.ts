import contact, { type Person } from '@hcengineering/contact'
import { type Ref } from '@hcengineering/core'
import { type PerfexReader, type PerfexTimeEntry } from '@hcengineering/perfex'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import {
  MAX_OPEN_TIMER_SECONDS,
  TIME_ENTRIES_CUTOFF,
  normalizeTimeEntry,
  planTimeEntries,
  importTimeEntries,
  timeEntryDescription,
  timeEntryKey
} from '../tiempo'

function timer(id: number, taskId: number, over: Partial<PerfexTimeEntry> = {}): PerfexTimeEntry {
  return { id, task_id: taskId, start_time: '1000', end_time: '4600', staff_id: 10, note: null, ...over }
}

function task(id: string): { id: Ref<Issue>; space: Ref<Project> } {
  return { id: id as Ref<Issue>, space: 'proyecto' as Ref<Project> }
}

describe('normalizeTimeEntry', () => {
  it('convierte un timer cerrado a segundos y horas preservables', () => {
    expect(normalizeTimeEntry(timer(1, 1))).toEqual({ startTime: 1000, endTime: 4600, closedSynthetic: false })
  })

  it('cierra un timer abierto con el corte cuando lleva menos de doce horas', () => {
    const start = TIME_ENTRIES_CUTOFF - 3600
    expect(normalizeTimeEntry(timer(2, 1, { start_time: String(start), end_time: null }))).toEqual({
      startTime: start,
      endTime: TIME_ENTRIES_CUTOFF,
      closedSynthetic: true
    })
  })

  it('limita a doce horas un timer abierto antiguo', () => {
    const start = TIME_ENTRIES_CUTOFF - MAX_OPEN_TIMER_SECONDS * 2
    expect(normalizeTimeEntry(timer(3, 1, { start_time: String(start), end_time: null }))).toEqual({
      startTime: start,
      endTime: start + MAX_OPEN_TIMER_SECONDS,
      closedSynthetic: true
    })
  })

  it('descarta rangos inválidos', () => {
    expect(normalizeTimeEntry(timer(4, 1, { end_time: '999' }))).toBeUndefined()
  })
})

describe('planTimeEntries', () => {
  it('omite los ya creados y deja fuera padres inexistentes', () => {
    const parent = task('padre-1')
    const result = planTimeEntries(
      [timer(1, 1), timer(2, 2), timer(3, 1)],
      new Map([[1, parent]]),
      new Set([timeEntryKey(parent.id, 1)])
    )

    expect(result.pending.map((entry) => entry.entry.id)).toEqual([3])
    expect(result.missingParent.map((entry) => entry.id)).toEqual([2])
    expect(result.invalid).toEqual([])
  })

  it('distingue el mismo timer bajo padres distintos', () => {
    const first = task('padre-1')
    const second = task('padre-2')
    const result = planTimeEntries(
      [timer(7, 1), timer(7, 2)],
      new Map([
        [1, first],
        [2, second]
      ]),
      new Set([timeEntryKey(first.id, 7)])
    )

    expect(result.pending.map((entry) => entry.task.id)).toEqual([second.id])
  })

  it('acepta una lista vacía', () => {
    expect(planTimeEntries([], new Map(), new Set())).toEqual({ pending: [], missingParent: [], invalid: [] })
  })
})

describe('timeEntryDescription', () => {
  it('anota el cierre sintético sin perder la nota', () => {
    expect(timeEntryDescription(timer(1, 1, { note: 'Análisis' }), true)).toContain('Probablemente quedó abierto')
    expect(timeEntryDescription(timer(1, 1, { note: 'Análisis' }), true)).toContain('Análisis')
  })
})

describe('importTimeEntries', () => {
  it('crea y reutiliza Employee sin crear cuenta', async () => {
    const person = 'persona-10' as Ref<Person>
    const findAll = jest.fn(async (classRef: string) => {
      if (classRef === tracker.class.Issue) return [{ _id: 'tarea-1', space: 'proyecto', perfexId: 1 }]
      return []
    })
    const client = {
      findAll,
      createMixin: jest.fn(),
      addCollection: jest.fn()
    }
    const perfex = { getTimeEntries: jest.fn().mockResolvedValue([timer(1, 1)]) }
    const logger = { log: jest.fn(), error: jest.fn() }

    await importTimeEntries(client as never, perfex as unknown as PerfexReader, logger, {
      dryRun: false,
      peopleByStaffId: { 10: person }
    })

    expect(client.createMixin).toHaveBeenCalledWith(
      person,
      contact.class.Person,
      contact.space.Contacts,
      contact.mixin.Employee,
      { active: true, role: 'USER' }
    )
    expect(client.addCollection).toHaveBeenCalledWith(
      tracker.class.TimeSpendReport,
      'proyecto',
      'tarea-1',
      tracker.class.Issue,
      'reports',
      expect.objectContaining({ employee: person, perfexTimerId: 1, value: 1 })
    )
  })

  it('conserva el tiempo sin empleado cuando falta la persona', async () => {
    const findAll = jest.fn(async (classRef: string) => {
      if (classRef === tracker.class.Issue) return [{ _id: 'tarea-1', space: 'proyecto', perfexId: 1 }]
      return []
    })
    const client = { findAll, createMixin: jest.fn(), addCollection: jest.fn() }
    const perfex = { getTimeEntries: jest.fn().mockResolvedValue([timer(1, 1)]) }
    const logger = { log: jest.fn(), error: jest.fn() }

    await importTimeEntries(client as never, perfex as unknown as PerfexReader, logger, {
      dryRun: false,
      peopleByStaffId: {}
    })

    expect(client.createMixin).not.toHaveBeenCalled()
    expect(client.addCollection).toHaveBeenCalledWith(
      tracker.class.TimeSpendReport,
      'proyecto',
      'tarea-1',
      tracker.class.Issue,
      'reports',
      expect.objectContaining({ employee: null })
    )
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('sin persona en ops'))
  })
})
