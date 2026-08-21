import { type Ref } from '@hcengineering/core'
import { type PerfexTask } from '@hcengineering/perfex'
import { type Project } from '@hcengineering/tracker'

import { crearLoggerConProgreso, type Destino, planificarProyectos } from '../proyectos'

function tarea (id: number): PerfexTask {
  return { id } as unknown as PerfexTask
}

function destino (title: string, tasks: number[], existente?: string): Destino {
  return {
    title,
    description: '',
    tasks: tasks.map(tarea),
    update: {},
    existente: existente as Ref<Project> | undefined
  }
}

describe('planificarProyectos', () => {
  it('crea entero el proyecto que no existe', () => {
    const plan = planificarProyectos([destino('EMSA', [1, 2, 3])], new Set())
    expect(plan.porCrear.map((d) => d.title)).toEqual(['EMSA'])
    expect(plan.porCompletar).toEqual([])
    expect(plan.total).toBe(3)
  })

  it('agrega las tareas nuevas de un proyecto que ya existe', () => {
    // El bug que arregla esto: la versión vieja salteaba la campaña entera y la tarea 3 no viajaba.
    const plan = planificarProyectos([destino('EMSA', [1, 2, 3], 'proj-emsa')], new Set([1, 2]))
    expect(plan.porCrear).toEqual([])
    expect(plan.porCompletar.map((d) => d.title)).toEqual(['EMSA'])
    expect(plan.tareasNuevas.get('EMSA')?.map((t) => t.id)).toEqual([3])
    expect(plan.total).toBe(1)
  })

  it('deja fuera el proyecto que existe y no tiene nada nuevo', () => {
    const plan = planificarProyectos([destino('EMSA', [1, 2], 'proj-emsa')], new Set([1, 2]))
    expect(plan.porCrear).toEqual([])
    expect(plan.porCompletar).toEqual([])
    expect(plan.total).toBe(0)
  })

  it('no vuelve a crear una tarea ya migrada aunque su proyecto sea nuevo', () => {
    // Pasa cuando una tarea cambió de campaña en el board: la tarea manda, no el proyecto.
    const plan = planificarProyectos([destino('Campaña nueva', [1, 9])], new Set([1]))
    expect(plan.porCrear.map((d) => d.title)).toEqual(['Campaña nueva'])
    expect(plan.tareasNuevas.get('Campaña nueva')?.map((t) => t.id)).toEqual([9])
    expect(plan.total).toBe(1)
  })

  it('una corrida sobre un workspace ya migrado no escribe nada', () => {
    const destinos = [destino('EMSA', [1, 2], 'proj-emsa'), destino('CODELCO', [3], 'proj-codelco')]
    const plan = planificarProyectos(destinos, new Set([1, 2, 3]))
    expect(plan.porCrear).toEqual([])
    expect(plan.porCompletar).toEqual([])
    expect(plan.total).toBe(0)
  })
})

describe('crearLoggerConProgreso', () => {
  it('incluye nombre y avance al crear proyectos y tareas', () => {
    const log = jest.fn()
    const logger = crearLoggerConProgreso({ log, error: jest.fn() }, 2, 4)

    logger.log('Creating project: ', 'Campaña Norte')
    logger.log('Project created: project-id')
    logger.log('Creating issue: Llamar cliente')
    logger.log('Issue created: issue-id')

    expect(log).toHaveBeenNthCalledWith(1, 'Creando proyecto: Campaña Norte')
    expect(log).toHaveBeenNthCalledWith(2, 'Proyecto creado: Campaña Norte (1/2 (50%))')
    expect(log).toHaveBeenNthCalledWith(3, 'Creando tarea: Llamar cliente')
    expect(log).toHaveBeenNthCalledWith(4, 'Tarea creada: Llamar cliente (1/4 (25%))')
  })
})
