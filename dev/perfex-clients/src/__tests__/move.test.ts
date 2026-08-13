import { type TxOperations } from '@hcengineering/core'

import { moveClient } from '../move'

const logger = { log: () => {}, error: () => {} }

/** Cliente de Huly mínimo: sólo lo que usa moveClient. */
function fakeClient (organization?: any): TxOperations {
  return {
    findOne: async () => organization,
    findAll: async () => [],
    createDoc: async () => undefined,
    addCollection: async () => undefined,
    remove: async () => undefined
  } as unknown as TxOperations
}

const organization = { _id: 'org1', _class: 'contact:class:Organization', name: 'Bodenor', city: 'Santiago' }

describe('mover un cliente entre workspaces', () => {
  it('falla si el cliente no está en el origen', async () => {
    await expect(
      moveClient(fakeClient(undefined), fakeClient(undefined), logger, {
        clientName: 'Bodenor',
        dryRun: false,
        keepSource: false
      })
    ).rejects.toThrow('No se encontró')
  })

  it('falla si el cliente ya existe en el destino, para no duplicarlo', async () => {
    await expect(
      moveClient(fakeClient(organization), fakeClient(organization), logger, {
        clientName: 'Bodenor',
        dryRun: false,
        keepSource: false
      })
    ).rejects.toThrow('ya existe')
  })

  it('en simulación no escribe ni borra nada', async () => {
    const source = fakeClient(organization)
    const target = fakeClient(undefined)
    const createDoc = jest.fn()
    const remove = jest.fn()
    ;(target as any).createDoc = createDoc
    ;(source as any).remove = remove

    const result = await moveClient(source, target, logger, {
      clientName: 'Bodenor',
      dryRun: true,
      keepSource: false
    })

    expect(result.organization).toBe('org1')
    expect(createDoc).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('con solo-copiar deja intacto el origen', async () => {
    const source = fakeClient(organization)
    const target = fakeClient(undefined)
    const remove = jest.fn()
    ;(source as any).remove = remove

    await moveClient(source, target, logger, { clientName: 'Bodenor', dryRun: false, keepSource: true })

    expect(remove).not.toHaveBeenCalled()
  })

  it('borra el original cuando el movimiento se completa', async () => {
    const source = fakeClient(organization)
    const target = fakeClient(undefined)
    const remove = jest.fn()
    ;(source as any).remove = remove

    await moveClient(source, target, logger, { clientName: 'Bodenor', dryRun: false, keepSource: false })

    expect(remove).toHaveBeenCalledWith(organization)
  })
})
