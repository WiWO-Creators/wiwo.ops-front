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

import type { AccountClient } from '@hcengineering/account-client'
import contact, { type Person, type SocialIdentityRef } from '@hcengineering/contact'
import {
  buildSocialIdString,
  Hierarchy,
  type MeasureMetricsContext,
  type PersonInfo,
  type Ref,
  SocialIdType,
  type TxOperations
} from '@hcengineering/core'

export interface EnsureMissingSocialIdentitiesResult {
  skippedPersons: number
  wouldCreate: number
  created: number
}

/**
 * For each workspace person linked to an account, ensures SocialIdentity docs exist
 * for every active account social id (same _id as in the account DB). See
 * {@link createSocialIdentities} in model-contact migration.
 */
export async function ensureMissingSocialIdentities (
  toolCtx: MeasureMetricsContext,
  ops: TxOperations,
  accountClient: Pick<AccountClient, 'getPersonInfo'>,
  dryRun: boolean
): Promise<EnsureMissingSocialIdentitiesResult> {
  let wouldCreate = 0
  let created = 0
  let skippedPersons = 0

  const persons = await ops.findAll(contact.class.Person, {})
  for (const person of persons) {
    const employee = ops.getHierarchy().as(person, contact.mixin.Employee)
    const personUuid = employee?.personUuid ?? person.personUuid
    if (personUuid == null) {
      skippedPersons++
      continue
    }
    let personInfo: PersonInfo
    try {
      personInfo = await accountClient.getPersonInfo(personUuid)
    } catch (err: any) {
      toolCtx.error('ensure-missing-social-identities: getPersonInfo failed', {
        person: person._id,
        personUuid,
        message: err?.message ?? String(err)
      })
      continue
    }
    const socials = (personInfo.socialIds ?? []).filter((s) => s.isDeleted !== true)
    for (const social of socials) {
      const socialDocId = social._id as SocialIdentityRef
      const expectedKey = buildSocialIdString({ type: social.type, value: social.value })
      if (social.key !== expectedKey) {
        toolCtx.warn('ensure-missing-social-identities: social key does not match type:value', {
          person: person._id,
          personUuid,
          socialId: social._id,
          key: social.key,
          expectedKey
        })
      }
      const existingById = await ops.findOne(contact.class.SocialIdentity, { _id: socialDocId })
      if (existingById != null) {
        continue
      }
      const existingByKey = await ops.findOne(contact.class.SocialIdentity, {
        attachedTo: person._id,
        key: social.key
      })
      if (existingByKey != null) {
        toolCtx.warn('ensure-missing-social-identities: SocialIdentity exists for key but different _id', {
          person: person._id,
          personUuid,
          accountSocialId: social._id,
          existingId: existingByKey._id,
          key: social.key
        })
        continue
      }
      if (dryRun) {
        wouldCreate++
        console.log(
          '[dry-run] missing SocialIdentity',
          JSON.stringify({
            person: person._id,
            personUuid,
            socialId: social._id,
            key: social.key,
            type: social.type
          })
        )
      } else {
        await ops.addCollection(
          contact.class.SocialIdentity,
          contact.space.Contacts,
          person._id,
          contact.class.Person,
          'socialIds',
          {
            type: social.type,
            value: social.value,
            key: social.key,
            isDeleted: false,
            ...(social.verifiedOn != null ? { verifiedOn: social.verifiedOn } : {}),
            ...(social.displayValue != null ? { displayValue: social.displayValue } : {})
          },
          socialDocId
        )
        created++
      }
    }
  }

  return { skippedPersons, wouldCreate, created }
}

export interface DuplicatePersonMatch {
  personId: Ref<Person>
  personName: string
  email: string
  employeeId: Ref<Person>
  employeeName: string
  reason: 'email' | 'name'
}

export interface ReportDuplicatePersonsResult {
  persons: number
  employees: number
  emailMatches: DuplicatePersonMatch[]
  nameMatches: DuplicatePersonMatch[]
}

function normalizeEmail (value: string): string {
  return value.trim().toLowerCase()
}

/**
 * Reports Person docs that look like a duplicate of an already existing employee, so they can be
 * merged by hand with MergePersons. Report only: choosing which field wins is a human decision.
 *
 * A person is a candidate when it has no Employee mixin and no personUuid (nobody logged in as it).
 * Employee emails are taken from both their SocialIdentity docs (auto registered employees only have
 * those) and their email Channel docs ("Create employee" fills in both).
 *
 * @param toolCtx - context used to report progress
 * @param ops - workspace client, only findAll is used
 * @returns counts plus one entry per match, email matches and the weaker name-only ones apart
 */
export async function reportDuplicatePersons (
  toolCtx: MeasureMetricsContext,
  ops: Pick<TxOperations, 'findAll'>
): Promise<ReportDuplicatePersonsResult> {
  const persons = await ops.findAll(contact.class.Person, {})
  const employees = persons.filter((person) => Hierarchy.hasMixin(person, contact.mixin.Employee))
  const employeeIds = new Set<Ref<Person>>(employees.map((employee) => employee._id))
  const nameById = new Map<Ref<Person>, string>(persons.map((person) => [person._id, person.name]))

  const emailChannels = await ops.findAll(contact.class.Channel, { provider: contact.channelProvider.Email })
  const socialIdentities = await ops.findAll(contact.class.SocialIdentity, {})

  // email -> employees owning it
  const employeesByEmail = new Map<string, Ref<Person>[]>()
  const addEmployeeEmail = (attachedTo: Ref<Person>, value: string): void => {
    if (!employeeIds.has(attachedTo)) {
      return
    }
    const email = normalizeEmail(value)
    if (email === '') {
      return
    }
    const owners = employeesByEmail.get(email) ?? []
    if (!owners.includes(attachedTo)) {
      owners.push(attachedTo)
      employeesByEmail.set(email, owners)
    }
  }

  for (const socialIdentity of socialIdentities) {
    if (socialIdentity.isDeleted === true) {
      continue
    }
    if (socialIdentity.type !== SocialIdType.EMAIL && socialIdentity.type !== SocialIdType.GOOGLE) {
      continue
    }
    addEmployeeEmail(socialIdentity.attachedTo, socialIdentity.value)
  }
  for (const channel of emailChannels) {
    addEmployeeEmail(channel.attachedTo as Ref<Person>, channel.value)
  }

  // employee name -> employees, used only for the weak name-only signal
  const employeesByName = new Map<string, Ref<Person>[]>()
  for (const employee of employees) {
    const name = employee.name?.trim() ?? ''
    if (name === '') {
      continue
    }
    const sameName = employeesByName.get(name) ?? []
    sameName.push(employee._id)
    employeesByName.set(name, sameName)
  }

  const emailsByPerson = new Map<Ref<Person>, string[]>()
  for (const channel of emailChannels) {
    const email = normalizeEmail(channel.value)
    if (email === '') {
      continue
    }
    const attachedTo = channel.attachedTo as Ref<Person>
    const emails = emailsByPerson.get(attachedTo) ?? []
    if (!emails.includes(email)) {
      emails.push(email)
      emailsByPerson.set(attachedTo, emails)
    }
  }

  const emailMatches: DuplicatePersonMatch[] = []
  const nameMatches: DuplicatePersonMatch[] = []

  for (const person of persons) {
    if (employeeIds.has(person._id) || person.personUuid != null) {
      continue
    }

    let matchedByEmail = false
    for (const email of emailsByPerson.get(person._id) ?? []) {
      for (const employeeId of employeesByEmail.get(email) ?? []) {
        matchedByEmail = true
        emailMatches.push({
          personId: person._id,
          personName: person.name,
          email,
          employeeId,
          employeeName: nameById.get(employeeId) ?? '',
          reason: 'email'
        })
      }
    }

    if (matchedByEmail) {
      continue
    }

    const name = person.name?.trim() ?? ''
    for (const employeeId of employeesByName.get(name) ?? []) {
      nameMatches.push({
        personId: person._id,
        personName: person.name,
        email: '',
        employeeId,
        employeeName: nameById.get(employeeId) ?? '',
        reason: 'name'
      })
    }
  }

  toolCtx.info('report-duplicate-persons: scanned', { persons: persons.length, employees: employees.length })
  for (const match of [...emailMatches, ...nameMatches]) {
    console.log(
      [match.personId, match.personName, match.email, match.employeeId, match.employeeName, match.reason].join(', ')
    )
  }

  return { persons: persons.length, employees: employees.length, emailMatches, nameMatches }
}
