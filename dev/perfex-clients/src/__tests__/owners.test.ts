import { AccountRole, type AccountUuid, type WorkspaceMemberInfo } from '@hcengineering/core'

import { type Cuentas } from '../permisos'
import { planificarOwners } from '../owners'

const ana = 'ana' as AccountUuid
const beto = 'beto' as AccountUuid

const cuentas: Cuentas = {
  porCorreo: new Map([
    ['ana@wiwo.me', ana],
    ['beto@wiwo.me', beto]
  ]),
  nombres: new Map()
}

describe('planificarOwners', () => {
  it('promueve sólo miembros que todavía no son owner', () => {
    const miembros: WorkspaceMemberInfo[] = [
      { person: ana, role: AccountRole.Owner },
      { person: beto, role: AccountRole.User }
    ]

    expect(planificarOwners(['ANA@wiwo.me', 'beto@wiwo.me', 'beto@wiwo.me'], cuentas, miembros)).toEqual([beto])
  })

  it('falla antes de escribir si un correo no tiene cuenta o membresía', () => {
    expect(() => planificarOwners(['nadie@wiwo.me'], cuentas, [])).toThrow('no tienen cuenta')
    expect(() => planificarOwners(['ana@wiwo.me'], cuentas, [])).toThrow('deben ser miembros')
  })
})
