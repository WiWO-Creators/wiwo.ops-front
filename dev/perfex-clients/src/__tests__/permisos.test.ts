import { type AccountUuid } from '@hcengineering/core'

import { calcularAccesos, correosDeCelda, parsearCsv } from '../permisos'

const ana = 'ana' as AccountUuid
const beto = 'beto' as AccountUuid
const cami = 'cami' as AccountUuid

describe('reparto de accesos de un proyecto', () => {
  it('deja al focal como dueño y miembro', () => {
    const accesos = calcularAccesos([ana], [beto])

    expect(accesos.owners).toEqual([ana])
    expect(accesos.members).toEqual([ana])
  })

  it('deja sin acceso a las personas asociadas que no son focal', () => {
    expect(calcularAccesos([ana], [beto, cami]).asociados).toEqual([beto, cami])
  })

  it('no anota como asociado al focal que también figura entre las personas', () => {
    expect(calcularAccesos([ana], [ana, beto]).asociados).toEqual([beto])
  })

  it('admite varios focales y no repite a nadie', () => {
    const accesos = calcularAccesos([ana, beto, ana], [beto, cami, cami])

    expect(accesos.owners).toEqual([ana, beto])
    expect(accesos.asociados).toEqual([cami])
  })

  it('deja el proyecto sin asociados cuando el board no lista a nadie más', () => {
    expect(calcularAccesos([ana], []).asociados).toEqual([])
  })
})

describe('lectura del CSV del board', () => {
  const encabezado = 'project_id,proyecto,estado,cliente,focal,personas_asociadas_board,contactos_cliente\n'

  it('saca los correos de una celda con varias personas', () => {
    expect(correosDeCelda('Ana Díaz <ana@wiwo.me> | Beto Paz <BETO@wiwo.me>')).toEqual(['ana@wiwo.me', 'beto@wiwo.me'])
  })

  it('devuelve una lista vacía si la celda no trae correos', () => {
    expect(correosDeCelda('')).toEqual([])
    expect(correosDeCelda('Ana Díaz')).toEqual([])
  })

  it('parte una fila en id, nombre, focales y personas', () => {
    const filas = parsearCsv(
      encabezado + '13,70 años - Linkedin,En progreso,Abastible,Ana <ana@wiwo.me>,Ana <ana@wiwo.me> | Beto <beto@wiwo.me>,\n'
    )

    expect(filas).toHaveLength(1)
    expect(filas[0]).toEqual({
      projectId: 13,
      proyecto: '70 años - Linkedin',
      focal: ['ana@wiwo.me'],
      personas: ['ana@wiwo.me', 'beto@wiwo.me']
    })
  })

  it('respeta las comas que van dentro de comillas', () => {
    const filas = parsearCsv(encabezado + '7,"Campaña, verano",En progreso,IKEA,Ana <ana@wiwo.me>,,\n')

    expect(filas[0].proyecto).toEqual('Campaña, verano')
    expect(filas[0].personas).toEqual([])
  })

  it('deja pasar el proyecto sin focal, para que el informe lo liste', () => {
    const filas = parsearCsv(encabezado + '9,Sin dueño,En progreso,IKEA,,Beto <beto@wiwo.me>,\n')

    expect(filas[0].focal).toEqual([])
  })

  it('avisa si al CSV le falta una columna que se usa', () => {
    expect(() => parsearCsv('project_id,proyecto\n1,Uno\n')).toThrow('personas_asociadas_board')
  })

  it('avisa si el archivo está vacío', () => {
    expect(() => parsearCsv('')).toThrow('vacío')
  })
})
