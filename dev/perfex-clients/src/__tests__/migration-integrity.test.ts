import contact, { type Person } from '@hcengineering/contact'
import core, { type PersonUuid, type Ref, type TxOperations } from '@hcengineering/core'

import { assertMigrationIntegrity, findDuplicatePersonUuids } from '../migration-integrity'

describe('integridad previa a la migración', () => {
  it('detecta personas repetidas por personUuid', () => {
    const people = [
      { _id: 'person-1' as Ref<Person>, personUuid: 'uuid-1' as PersonUuid },
      { _id: 'person-2' as Ref<Person>, personUuid: 'uuid-1' as PersonUuid },
      { _id: 'person-3' as Ref<Person>, personUuid: 'uuid-2' as PersonUuid }
    ]

    expect(findDuplicatePersonUuids(people)).toEqual([
      { personUuid: 'uuid-1', people: ['person-1', 'person-2'] }
    ])
  })

  it('bloquea antes de leer personas si falta el SystemSpace de contactos', async () => {
    const findOne = jest.fn().mockResolvedValue(undefined)
    const findAll = jest.fn()
    const client = {
      findOne,
      findAll
    } as unknown as TxOperations

    await expect(assertMigrationIntegrity(client)).rejects.toThrow('falta contact:space:Contacts como SystemSpace')
    expect(findOne).toHaveBeenCalledWith(core.class.Space, { _id: contact.space.Contacts })
    expect(findAll).not.toHaveBeenCalled()
  })

  it('bloquea duplicados sin ejecutar una limpieza destructiva', async () => {
    const client = {
      findOne: jest.fn().mockResolvedValue({ _class: core.class.SystemSpace }),
      findAll: jest.fn().mockResolvedValue([
        { _id: 'person-1', personUuid: 'uuid-1' },
        { _id: 'person-2', personUuid: 'uuid-1' }
      ])
    } as unknown as TxOperations

    await expect(assertMigrationIntegrity(client)).rejects.toThrow(
      '1 personUuid duplicados (1 personas extra)'
    )
  })
})
