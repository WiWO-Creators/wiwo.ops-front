import { type Person } from '@hcengineering/contact'
import { type Ref } from '@hcengineering/core'
import { type PerfexChecklistItem } from '@hcengineering/perfex'
import { type Issue, type Project } from '@hcengineering/tracker'

import { aSubtarea, claveDeChecklist, planificarChecklists, type TareaPadre } from '../checklists'

function item(id: number, taskid: number, over: Partial<PerfexChecklistItem> = {}): PerfexChecklistItem {
  return {
    id,
    taskid,
    description: `Ítem ${id}`,
    finished: 0,
    list_order: id,
    assigned: null,
    ...over
  }
}

function parent(id: string): TareaPadre {
  return {
    id: id as Ref<Issue>,
    space: 'proyecto' as Ref<Project>,
    milestone: null,
    title: 'Tarea padre',
    identifier: 'PFX-1'
  }
}

describe('planificarChecklists', () => {
  it('ordena por tarea, posición e id y omite los ya creados', () => {
    const first = parent('padre-1')
    const second = parent('padre-2')
    const items = [item(3, 1, { list_order: 2 }), item(2, 1, { list_order: 1 }), item(1, 2, { list_order: 1 })]
    const plan = planificarChecklists(
      items,
      new Map([
        [1, first],
        [2, second]
      ]),
      new Set([claveDeChecklist(first.id, 3)])
    )

    expect(plan.pendientes.map((checklist) => checklist.item.id)).toEqual([2, 1])
    expect(plan.sinPadre).toEqual([])
  })

  it('deja fuera los ítems cuyo padre no está en el workspace', () => {
    const plan = planificarChecklists([item(1, 99)], new Map(), new Set())

    expect(plan.pendientes).toEqual([])
    expect(plan.sinPadre.map((checklist) => checklist.id)).toEqual([1])
  })

  it('distingue la misma id de checklist bajo padres distintos', () => {
    const first = parent('padre-1')
    const second = parent('padre-2')
    const items = [item(7, 1), item(7, 2)]
    const plan = planificarChecklists(
      items,
      new Map([
        [1, first],
        [2, second]
      ]),
      new Set([claveDeChecklist(first.id, 7)])
    )

    expect(plan.pendientes.map((checklist) => checklist.parent.id)).toEqual([second.id])
  })

  it('acepta listas vacías', () => {
    expect(planificarChecklists([], new Map(), new Set())).toEqual({ pendientes: [], sinPadre: [] })
  })
})

describe('aSubtarea', () => {
  it('preserva estado completado, responsable, hito y ancla del board', () => {
    const person = 'persona-1' as Ref<Person>
    const issue = aSubtarea(item(11, 4, { finished: 1, assigned: 20 }), parent('padre-4'), person)

    expect(issue.status.name).toBe('Completada')
    expect(issue.assignee).toBe(person)
    expect(issue.additionalData).toMatchObject({ perfexId: 11, milestone: null })
  })

  it('convierte un ítem pendiente y sin responsable', () => {
    const issue = aSubtarea(item(12, 4, { description: 'Pendiente' }), parent('padre-4'), undefined)

    expect(issue.status.name).toBe('Sin empezar')
    expect(issue.assignee).toBeUndefined()
    expect(issue.title).toBe('Pendiente')
  })
})
