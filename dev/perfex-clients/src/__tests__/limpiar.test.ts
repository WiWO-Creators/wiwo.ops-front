import attachment from '@hcengineering/attachment'
import contact from '@hcengineering/contact'
import { type TxOperations } from '@hcengineering/core'
import tags from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { cleanWorkspace, type CleanResult } from '../limpiar'

const expected: CleanResult = {
  projects: 1,
  issues: 1,
  organizations: 1,
  people: 1,
  attachments: 1,
  tags: 1,
  preservedPeople: 1
}

function createClient (
  people: Array<{ _id: string, personUuid?: string }> = [
    { _id: 'contact-1' },
    { _id: 'user-1', personUuid: 'account-1' }
  ]
): { client: TxOperations, remove: jest.Mock } {
  const documents = new Map<unknown, any[]>([
    [tracker.class.Project, [{ _id: 'project-1' }]],
    [tracker.class.Issue, [{ _id: 'issue-1' }]],
    [contact.class.Organization, [{ _id: 'organization-1' }]],
    [contact.class.Person, people],
    [
      attachment.class.Attachment,
      [
        { _id: 'attachment-1', attachedTo: 'issue-1' },
        { _id: 'user-attachment', attachedTo: 'user-1' }
      ]
    ],
    [tags.class.TagElement, [{ _id: 'tag-1', targetClass: tracker.class.Issue }]],
    [contact.class.Channel, []],
    [contact.class.Member, []]
  ])
  const remove = jest.fn(async () => undefined)
  const client = {
    findAll: jest.fn(async (classRef: unknown) => documents.get(classRef) ?? []),
    remove
  } as unknown as TxOperations
  return { client, remove }
}

describe('limpieza del workspace', () => {
  it('informa todo lo borrable y preserva usuarios sin escribir', async () => {
    const { client, remove } = createClient()

    await expect(cleanWorkspace(client, { log: jest.fn(), error: jest.fn() }, { dryRun: true })).resolves.toEqual(
      expected
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it('rechaza conteos vencidos antes del primer borrado', async () => {
    const { client, remove } = createClient()

    await expect(
      cleanWorkspace(
        client,
        { log: jest.fn(), error: jest.fn() },
        {
          dryRun: false,
          expected: { ...expected, projects: 2 }
        }
      )
    ).rejects.toThrow('cambió desde la vista previa')
    expect(remove).not.toHaveBeenCalled()
  })

  it('no borra cuando hay varias personas locales para la misma cuenta', async () => {
    const { client, remove } = createClient([
      { _id: 'user-1', personUuid: 'account-1' },
      { _id: 'user-2', personUuid: 'account-1' }
    ])

    await expect(cleanWorkspace(client, { log: jest.fn(), error: jest.fn() }, { dryRun: true })).rejects.toThrow(
      '1 personUuid duplicados'
    )
    expect(remove).not.toHaveBeenCalled()
  })

  it('borra datos de negocio y nunca elimina la persona con cuenta', async () => {
    const { client, remove } = createClient()

    await cleanWorkspace(client, { log: jest.fn(), error: jest.fn() }, { dryRun: false, expected })

    const removedIds = remove.mock.calls.map(([document]) => document._id)
    expect(removedIds).toEqual(
      expect.arrayContaining(['attachment-1', 'project-1', 'organization-1', 'contact-1', 'tag-1'])
    )
    expect(removedIds).not.toContain('user-1')
    expect(removedIds).not.toContain('user-attachment')
  })
})
