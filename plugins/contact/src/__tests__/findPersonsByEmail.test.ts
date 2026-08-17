//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type Class, type Client, type Doc, type PersonUuid, type Ref } from '@hcengineering/core'

import contact, { type Channel, type Person, type SocialIdentity } from '..'
import { findPersonsByEmail, findPersonToClaimByEmail } from '../utils'

/**
 * Postgres ILIKE semantics: % matches any sequence, _ matches a single char, case insensitive.
 * Modelled here on purpose so the JS re-filtering of the helper is actually exercised.
 */
function likeToRegExp (like: string): RegExp {
  const pattern = like
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.')
  return new RegExp(`^${pattern}$`, 'i')
}

function channelFixture (attachedTo: string, value: string): Channel {
  return {
    _id: `channel-${attachedTo}-${value}`,
    _class: contact.class.Channel,
    attachedTo: attachedTo as Ref<Person>,
    attachedToClass: contact.class.Person,
    collection: 'channels',
    provider: contact.channelProvider.Email,
    value
  } as unknown as Channel
}

function personFixture (id: string, personUuid?: string): Person {
  return {
    _id: id as Ref<Person>,
    _class: contact.class.Person,
    name: id,
    personUuid: personUuid as PersonUuid | undefined
  } as unknown as Person
}

function createClient (data: {
  channels?: Channel[]
  persons?: Person[]
  socialIds?: Array<Partial<SocialIdentity>>
}): Pick<Client, 'findAll'> {
  const findAll = async (_class: Ref<Class<Doc>>, query: any): Promise<any> => {
    if (_class === contact.class.Channel) {
      const matcher = likeToRegExp(query.value.$like)
      return (data.channels ?? []).filter((it) => it.provider === query.provider && matcher.test(it.value))
    }
    if (_class === contact.class.Person) {
      return (data.persons ?? []).filter((it) => it._id === query._id)
    }
    if (_class === contact.class.SocialIdentity) {
      return (data.socialIds ?? []).filter((it) => it.attachedTo === query.attachedTo)
    }
    return []
  }

  return { findAll } as unknown as Pick<Client, 'findAll'>
}

describe('findPersonsByEmail', () => {
  it('matches regardless of capitalization and of spaces stored in the channel', async () => {
    const client = createClient({
      channels: [channelFixture('p1', ' Juan.Perez@X.com ')]
    })

    expect(await findPersonsByEmail(client, 'juan.perez@x.com')).toEqual(['p1'])
  })

  it('does not over match an email containing an underscore', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'juanXperez@x.com'), channelFixture('p2', 'juan_perez@x.com')]
    })

    expect(await findPersonsByEmail(client, 'juan_perez@x.com')).toEqual(['p2'])
  })

  it('returns each person once and nothing when there is no channel', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'juan@x.com'), channelFixture('p1', 'JUAN@x.com')]
    })

    expect(await findPersonsByEmail(client, 'juan@x.com')).toEqual(['p1'])
    expect(await findPersonsByEmail(client, 'otro@x.com')).toEqual([])
    expect(await findPersonsByEmail(client, '  ')).toEqual([])
  })
})

describe('findPersonToClaimByEmail', () => {
  it('claims the single person without account nor social identities', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'Juan@x.com')],
      persons: [personFixture('p1')]
    })

    const { person, candidates } = await findPersonToClaimByEmail(client, 'juan@x.com')

    expect(person?._id).toBe('p1')
    expect(candidates).toEqual(['p1'])
  })

  it('does not claim anything when two persons share the email', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'juan@x.com'), channelFixture('p2', 'juan@x.com')],
      persons: [personFixture('p1'), personFixture('p2')]
    })

    const { person, candidates } = await findPersonToClaimByEmail(client, 'juan@x.com')

    expect(person).toBeUndefined()
    expect(candidates).toEqual(['p1', 'p2'])
  })

  it('does not claim a person already owned by an account', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'juan@x.com')],
      persons: [personFixture('p1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')]
    })

    expect((await findPersonToClaimByEmail(client, 'juan@x.com')).person).toBeUndefined()
  })

  it('does not claim a person with a social identity attached', async () => {
    const client = createClient({
      channels: [channelFixture('p1', 'juan@x.com')],
      persons: [personFixture('p1')],
      socialIds: [{ attachedTo: 'p1' as Ref<Person> }]
    })

    expect((await findPersonToClaimByEmail(client, 'juan@x.com')).person).toBeUndefined()
  })

  it('does not claim a channel attached to something that is not a person', async () => {
    const client = createClient({
      channels: [channelFixture('org1', 'juan@x.com')],
      persons: []
    })

    expect((await findPersonToClaimByEmail(client, 'juan@x.com')).person).toBeUndefined()
  })
})
