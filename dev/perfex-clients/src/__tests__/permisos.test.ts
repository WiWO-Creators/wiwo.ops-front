import { type AccountUuid } from '@hcengineering/core'
import { type PerfexClient, type PerfexProject, type PerfexStaff } from '@hcengineering/perfex'

import { calcularAccesos, controlarAdminsClientes, correosDeCelda, parsearCsv, type Cuentas } from '../permisos'

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

  it('suma como miembros a los administradores del tipo de proyecto, sin hacerlos dueños', () => {
    const accesos = calcularAccesos([ana], [beto], [cami])

    expect(accesos.owners).toEqual([ana])
    expect(accesos.members).toEqual([ana, cami])
    expect(accesos.equipo).toEqual([cami])
    expect(accesos.asociados).toEqual([beto])
  })

  it('no anota como asociado a un administrador que además figura en el board', () => {
    expect(calcularAccesos([ana], [beto, cami], [cami]).asociados).toEqual([beto])
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

describe('control de admins de cliente', () => {
  const cuentas: Cuentas = {
    porCorreo: new Map([
      ['ana@wiwo.me', ana],
      ['beto@wiwo.me', beto]
    ]),
    nombres: new Map()
  }

  it('informa cliente sin focal, admin sin cuenta y admin omitido por el CSV', () => {
    const control = controlarAdminsClientes(
      [
        {
          projectId: 7,
          proyecto: 'Campaña uno',
          focal: ['ana@wiwo.me'],
          personas: []
        }
      ],
      [
        { id: 7, clientid: 10 },
        { id: 8, clientid: 11 }
      ] as unknown as PerfexProject[],
      [
        { id: 10, company: 'Acme' },
        { id: 11, company: 'Beta' }
      ] as unknown as PerfexClient[],
      [
        { clientId: 10, staffId: 1 },
        { clientId: 10, staffId: 2 },
        { clientId: 11, staffId: 3 }
      ],
      [
        { staffid: 1, email: 'ana@wiwo.me' },
        { staffid: 2, email: 'beto@wiwo.me' },
        { staffid: 3, email: 'sin-cuenta@wiwo.me' }
      ] as unknown as PerfexStaff[],
      cuentas
    )

    expect(control.clientesSinFocal).toEqual(['Beta'])
    expect(control.adminsFueraDelCsv).toEqual(['Acme: beto@wiwo.me'])
    expect(control.adminsSinCuenta).toEqual(['Beta: sin-cuenta@wiwo.me'])
  })
})
