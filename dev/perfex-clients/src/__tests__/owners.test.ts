import { AccountRole, type AccountUuid, type WorkspaceMemberInfo } from '@hcengineering/core'
import { getAccountClient } from '@hcengineering/server-client'

import { type Cuentas } from '../permisos'
import { asignarOwners, planificarOwners } from '../owners'

jest.mock('@hcengineering/server-client', () => ({ getAccountClient: jest.fn() }))

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

    expect(planificarOwners(['ANA@wiwo.me', 'beto@wiwo.me', 'beto@wiwo.me'], cuentas, miembros)).toEqual({
      promover: [beto],
      invitar: []
    })
  })

  it('invita a quien todavía no tiene cuenta o membresía', () => {
    expect(planificarOwners(['nadie@wiwo.me'], cuentas, [])).toEqual({ promover: [], invitar: ['nadie@wiwo.me'] })
    expect(planificarOwners(['ana@wiwo.me'], cuentas, [])).toEqual({ promover: [], invitar: ['ana@wiwo.me'] })
  })

  it('sigue exigiendo al menos un owner', () => {
    expect(() => planificarOwners([], cuentas, [])).toThrow('al menos un --owner')
  })
})

describe('asignarOwners', () => {
  it('envía una invitación Owner si el correo todavía no tiene cuenta', async () => {
    const resendInvite = jest.fn(async () => {})
    const accountClient = { getWorkspaceMembers: jest.fn(async () => []), resendInvite }
    const getAccountClientMock = getAccountClient as jest.MockedFunction<typeof getAccountClient>
    getAccountClientMock.mockReturnValue(accountClient as never)
    const client = { findAll: jest.fn(async () => []) }
    const logger = { log: jest.fn(), error: jest.fn() }

    await expect(
      asignarOwners(client as never, 'token', logger, ['gerencia@wiwo.me'], { dryRun: false })
    ).resolves.toBe(1)
    expect(resendInvite).toHaveBeenCalledWith('gerencia@wiwo.me', AccountRole.Owner)
    expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('invitación owner enviada'))
  })
})
