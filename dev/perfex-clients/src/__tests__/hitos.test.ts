import { MilestoneStatus } from '@hcengineering/tracker'

import { toHulyMilestone, toMilestoneStatus, toPaletteColor, toTimestamp } from '../hitos'
import { type PerfexMilestone, type PerfexTask } from '../perfex'

const HOY = new Date('2026-08-20').getTime()

function hito (over: Partial<PerfexMilestone> = {}): PerfexMilestone {
  return {
    id: 1,
    name: 'SEMANA 1',
    description: null,
    start_date: '2026-08-06',
    due_date: '2026-08-10',
    project_id: 7,
    color: null,
    milestone_order: 1,
    ...over
  }
}

function tarea (status: number): PerfexTask {
  return {
    id: 1,
    name: 'Tarea',
    description: null,
    priority: 2,
    status,
    dateadded: new Date('2026-08-01'),
    startdate: '2026-08-01',
    duedate: '2026-08-05',
    rel_id: 7,
    rel_type: 'project',
    milestone: 1,
    companyArea: [],
    assignees: []
  }
}

describe('fechas del hito', () => {
  it('convierte la fecha de Perfex a timestamp', () => {
    expect(toTimestamp('2026-08-06')).toBe(new Date('2026-08-06').getTime())
  })

  it('devuelve null cuando la fecha viene vacía', () => {
    expect(toTimestamp(null)).toBeNull()
    expect(toTimestamp('')).toBeNull()
  })

  it('cae a la fecha de inicio cuando falta la de entrega', () => {
    const datos = toHulyMilestone(hito({ due_date: '' }), [], HOY)
    expect(datos.targetDate).toBe(new Date('2026-08-06').getTime())
  })

  it('sin ninguna fecha usa el momento de la migración, porque Huly la exige', () => {
    const datos = toHulyMilestone(hito({ due_date: '', start_date: null }), [], HOY)
    expect(datos.targetDate).toBe(HOY)
    expect(datos.startDate).toBeNull()
  })
})

describe('estado del hito', () => {
  it('está completado si todas sus tareas lo están', () => {
    expect(toMilestoneStatus(hito(), [tarea(5), tarea(5)], HOY)).toBe(MilestoneStatus.Completed)
  })

  it('sigue en progreso si le queda una tarea abierta', () => {
    expect(toMilestoneStatus(hito(), [tarea(5), tarea(2)], HOY)).toBe(MilestoneStatus.InProgress)
  })

  it('está planificado si todavía no empezó', () => {
    expect(toMilestoneStatus(hito({ start_date: '2026-09-01' }), [], HOY)).toBe(MilestoneStatus.Planned)
  })

  it('el hito sin tareas que ya empezó queda en progreso, no completado', () => {
    expect(toMilestoneStatus(hito(), [], HOY)).toBe(MilestoneStatus.InProgress)
  })
})

describe('color del hito', () => {
  it('el hito sin color no lleva ninguno', () => {
    expect(toPaletteColor(null)).toBeUndefined()
    expect(toPaletteColor('')).toBeUndefined()
    expect(toPaletteColor('no-es-un-color')).toBeUndefined()
  })

  it('el celeste de Perfex cae en un celeste de la paleta', () => {
    // #03a9f4 tiene tono 199; el más cercano de la paleta es Aqua (200), en el índice 4.
    expect(toPaletteColor('#03a9f4')).toBe(4)
  })

  it('el violeta de Perfex cae en un violeta de la paleta', () => {
    // #8e24aa tiene tono 288; el más cercano es Blossom (300), en el índice 15.
    expect(toPaletteColor('#8e24aa')).toBe(15)
  })

  it('nunca devuelve el gris de "sin asignar"', () => {
    expect(toPaletteColor('#808080')).not.toBe(0)
  })

  it('acepta el hexadecimal corto y sin numeral', () => {
    expect(toPaletteColor('0af')).toBe(toPaletteColor('#00aaff'))
  })
})

describe('nombre del hito', () => {
  it('el hito sin nombre queda identificado por su id', () => {
    expect(toHulyMilestone(hito({ name: '   ' }), [], HOY).label).toBe('Hito 1')
  })
})
