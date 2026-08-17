import { type AccountUuid } from '@hcengineering/core'

import { calcularMiembros } from '../cerrar'

const ana = 'ana' as AccountUuid
const beto = 'beto' as AccountUuid
const jefa = 'jefa' as AccountUuid

describe('quién queda en un proyecto al cerrarlo', () => {
  it('saca al miembro que no tiene ninguna tarea', () => {
    const { quedan, salen } = calcularMiembros([ana, beto], [ana], [])

    expect(quedan).toEqual([ana])
    expect(salen).toEqual([beto])
  })

  it('mete al que tiene tareas aunque no fuera miembro', () => {
    const { quedan, salen } = calcularMiembros([ana], [ana, beto], [])

    expect(quedan).toEqual([ana, beto])
    expect(salen).toEqual([])
  })

  it('deja siempre a los administradores del tipo de proyecto, con tareas o sin ellas', () => {
    const { quedan, salen } = calcularMiembros([ana, jefa], [ana], [jefa])

    expect(quedan).toContain(jefa)
    expect(salen).toEqual([])
  })
})
