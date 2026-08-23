import contact from '@hcengineering/contact'
import core from '@hcengineering/core'
import { type PerfexFollower, type PerfexReader, type PerfexTask } from '@hcengineering/perfex'
import tracker from '@hcengineering/tracker'

import { importColaboradores, planificarColaboradores } from '../colaboradores'
import { buildIssueDescription } from '../proyectos'

function tarea (id: number, status: number, assignees: number[]): PerfexTask {
  return {
    id,
    name: `Tarea ${id}`,
    description: null,
    priority: 2,
    status,
    dateadded: new Date('2026-08-01'),
    startdate: null,
    duedate: null,
    rel_id: null,
    rel_type: null,
    milestone: 0,
    companyArea: [],
    assignees
  }
}

function seguidor (taskid: number, staffid: number): PerfexFollower {
  return { taskid, staffid }
}

/** Ordena para poder comparar sin depender del orden de recorrido de los mapas. */
function claves (plan: Array<{ taskid: number, staffid: number }>): string[] {
  return plan.map((c) => `${c.taskid}:${c.staffid}`).sort()
}

describe('planificarColaboradores', () => {
  const abiertas = { includeClosedTasks: false }

  it('junta seguidores y asignados extra sin repetir', () => {
    const plan = planificarColaboradores(
      [tarea(1, 2, [10, 11, 12])],
      [seguidor(1, 11), seguidor(1, 20)],
      abiertas
    )
    expect(claves(plan)).toEqual(['1:11', '1:12', '1:20'])
  })

  it('deja fuera al asignado principal, que Huly ya da de alta solo', () => {
    const plan = planificarColaboradores([tarea(1, 2, [10, 11])], [seguidor(1, 10)], abiertas)
    expect(claves(plan)).toEqual(['1:11'])
  })

  it('descarta las filas repetidas del board', () => {
    const plan = planificarColaboradores(
      [tarea(1, 2, [10])],
      [seguidor(1, 20), seguidor(1, 20), seguidor(1, 20)],
      abiertas
    )
    expect(claves(plan)).toEqual(['1:20'])
  })

  it('deja fuera las tareas completadas, salvo que se pidan', () => {
    const tasks = [tarea(1, 5, [10, 11]), tarea(2, 2, [10, 12])]
    const followers = [seguidor(1, 30), seguidor(2, 31)]

    expect(claves(planificarColaboradores(tasks, followers, abiertas))).toEqual(['2:12', '2:31'])
    expect(claves(planificarColaboradores(tasks, followers, { includeClosedTasks: true }))).toEqual([
      '1:11',
      '1:30',
      '2:12',
      '2:31'
    ])
  })

  it('ignora los seguidores de tareas que no están en el board', () => {
    const plan = planificarColaboradores([tarea(1, 2, [10])], [seguidor(999, 20)], abiertas)
    expect(plan).toEqual([])
  })

  it('acepta una tarea sin ningún asignado', () => {
    const plan = planificarColaboradores([tarea(1, 2, [])], [seguidor(1, 20)], abiertas)
    expect(claves(plan)).toEqual(['1:20'])
  })

  it('no devuelve nada cuando no hay tareas ni seguidores', () => {
    expect(planificarColaboradores([], [], abiertas)).toEqual([])
  })
})

describe('importColaboradores', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    jest.useRealTimers()
  })

  it('escribe secuencialmente y espera 30 segundos cada cinco colaboradores', async () => {
    jest.useFakeTimers()
    const timeoutSpy = jest.spyOn(global, 'setTimeout')
    const tasks = Array.from({ length: 12 }, (_, index) => tarea(index + 1, 2, [1]))
    const followers = tasks.map((task, index) => seguidor(task.id, index + 100))
    const employees = followers.map(({ staffid }) => ({
      _id: `person-${staffid}`,
      personUuid: `account-${staffid}`,
      name: `Persona ${staffid}`
    }))
    const socialIdentities = followers.map(({ staffid }) => ({
      attachedTo: `person-${staffid}`,
      value: `persona-${staffid}@wiwo.me`
    }))
    const issues = tasks.map(({ id }) => ({ _id: `issue-${id}`, space: 'project', perfexId: id }))
    const findAll = jest.fn(async (classRef: string) => {
      if (classRef === contact.mixin.Employee) return employees
      if (classRef === contact.class.SocialIdentity) return socialIdentities
      if (classRef === tracker.class.Issue) return issues
      if (classRef === core.class.Collaborator) return []
      return []
    })
    let activeWrites = 0
    let maximumActiveWrites = 0
    const addCollection = jest.fn(async () => {
      activeWrites++
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
      await Promise.resolve()
      activeWrites--
    })
    const perfex = {
      getTasks: jest.fn().mockResolvedValue(tasks),
      getFollowers: jest.fn().mockResolvedValue(followers),
      getStaff: jest.fn().mockResolvedValue(
        followers.map(({ staffid }) => ({ staffid, email: `persona-${staffid}@wiwo.me` }))
      )
    }
    const client = { findAll, addCollection }

    const migration = importColaboradores(
      client as never,
      perfex as unknown as PerfexReader,
      { log: jest.fn(), error: jest.fn() },
      { dryRun: false, includeClosedTasks: false }
    )
    await jest.runAllTimersAsync()
    await migration

    expect(addCollection).toHaveBeenCalledTimes(12)
    expect(maximumActiveWrites).toBe(1)
    expect(timeoutSpy.mock.calls.filter(([, delay]) => delay === 30_000)).toHaveLength(2)
  })
})

describe('descripción de la tarea', () => {
  it('ya no agrega la nota de otros asignados: ahora son colaboradores', () => {
    const task = tarea(1, 2, [10, 11, 12])
    task.description = '<p>Hay que hacerlo</p>'
    expect(buildIssueDescription(task)).not.toContain('Otros asignados en Perfex')
  })

  it('deja vacía la descripción de una tarea sin texto', () => {
    expect(buildIssueDescription(tarea(1, 2, [10, 11]))).toBe('')
  })
})
