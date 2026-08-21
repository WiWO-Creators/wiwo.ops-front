import { colorDeEtiqueta, normalizarNombre, planificarEtiquetas } from '../etiquetas'
import { type PerfexTag, type PerfexTagAssignment } from '../perfex'

const tag = (id: number, name: string): PerfexTag => ({ id, name })
const uso = (tagId: number, relId: number, relType: string): PerfexTagAssignment => ({
  tag_id: tagId,
  rel_id: relId,
  rel_type: relType
})

describe('normalizarNombre', () => {
  it('ignora mayúsculas y espacios sobrantes', () => {
    expect(normalizarNombre('  Diseño ')).toBe(normalizarNombre('diseño'))
  })
})

describe('colorDeEtiqueta', () => {
  it('es estable y cae dentro de la paleta', () => {
    for (const nombre of ['diseño', 'redes', 'urgente', '']) {
      const color = colorDeEtiqueta(nombre)
      expect(color).toBeGreaterThanOrEqual(0)
      expect(color).toBeLessThan(24)
      expect(colorDeEtiqueta(nombre)).toBe(color)
    }
  })
})

describe('planificarEtiquetas', () => {
  it('funde las etiquetas que sólo cambian en mayúsculas o espacios', () => {
    const plan = planificarEtiquetas([tag(1, 'Diseño'), tag(2, 'diseño ')], [uso(1, 10, 'task'), uso(2, 11, 'task')], 1)

    expect(plan.elementos).toHaveLength(1)
    expect(plan.elementos[0].nombre).toBe('Diseño')
    expect(plan.elementos[0].perfexIds).toEqual([1, 2])
    expect(plan.elementos[0].tareas).toEqual([10, 11])
  })

  it('separa los usos de tareas y de proyectos e ignora el resto', () => {
    const plan = planificarEtiquetas(
      [tag(1, 'Redes')],
      [uso(1, 10, 'task'), uso(1, 20, 'project'), uso(1, 30, 'lead')],
      1
    )

    expect(plan.elementos[0].tareas).toEqual([10])
    expect(plan.elementos[0].proyectos).toEqual([20])
  })

  it('no repite un uso que el board tiene cargado dos veces', () => {
    const plan = planificarEtiquetas([tag(1, 'Redes')], [uso(1, 10, 'task'), uso(1, 10, 'task')], 1)

    expect(plan.elementos[0].tareas).toEqual([10])
  })

  it('descarta las etiquetas que no llegan al umbral de usos', () => {
    const plan = planificarEtiquetas(
      [tag(1, 'Redes'), tag(2, 'Suelta'), tag(3, 'Sin uso')],
      [uso(1, 10, 'task'), uso(1, 11, 'task'), uso(2, 12, 'task')],
      2
    )

    expect(plan.elementos.map((e) => e.nombre)).toEqual(['Redes'])
    expect(plan.descartadas.map((e) => e.nombre)).toEqual(['Suelta', 'Sin uso'])
  })

  it('con umbral 0 igual deja fuera las etiquetas sin ningún uso', () => {
    const plan = planificarEtiquetas([tag(1, 'Sin uso')], [], 0)

    expect(plan.elementos).toHaveLength(0)
    expect(plan.descartadas).toHaveLength(1)
  })

  it('ignora una asignación cuya etiqueta ya no existe', () => {
    const plan = planificarEtiquetas([tag(1, 'Redes')], [uso(99, 10, 'task')], 1)

    expect(plan.elementos).toHaveLength(0)
  })

  it('ordena de más usada a menos', () => {
    const plan = planificarEtiquetas(
      [tag(1, 'Poco'), tag(2, 'Mucho')],
      [uso(1, 10, 'task'), uso(2, 11, 'task'), uso(2, 12, 'project')],
      1
    )

    expect(plan.elementos.map((e) => e.nombre)).toEqual(['Mucho', 'Poco'])
  })
})
