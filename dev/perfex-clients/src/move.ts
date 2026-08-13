//
// Mover un cliente de un workspace de Huly a otro.
//
// Huly no puede mover documentos entre workspaces, porque cada uno es una base separada. Lo que
// hace este módulo es copiar la organización con sus canales, sus contactos y los canales de esos
// contactos al workspace destino, y recién después borrarla del origen.
//
import contact, { type Channel, type Member, type Organization, type Person } from '@hcengineering/contact'
import { generateId, type Data, type Ref, type TxOperations } from '@hcengineering/core'

import { type Logger } from './import'

export interface MoveOptions {
  /** Nombre de la organización tal como figura en el workspace de origen. */
  clientName: string
  /** Si es true no escribe nada: sólo informa qué movería. */
  dryRun: boolean
  /** Si es true copia al destino pero no borra del origen, para revisar antes de perder nada. */
  keepSource: boolean
}

/** Lo que se copió al destino, para poder informarlo. */
export interface MoveResult {
  organization: Ref<Organization>
  channels: number
  contacts: number
}

/**
 * Copia un cliente al workspace destino y lo borra del de origen.
 *
 * @param source cliente de Huly conectado al workspace de origen.
 * @param target cliente de Huly conectado al workspace destino.
 * @throws Error si el cliente no existe en el origen, o si ya existe en el destino.
 */
export async function moveClient (
  source: TxOperations,
  target: TxOperations,
  logger: Logger,
  options: MoveOptions
): Promise<MoveResult> {
  const organization = await source.findOne(contact.class.Organization, { name: options.clientName })
  if (organization === undefined) {
    throw new Error(`No se encontró el cliente "${options.clientName}" en el workspace de origen`)
  }

  const existing = await target.findOne(contact.class.Organization, { name: options.clientName })
  if (existing !== undefined) {
    throw new Error(`El cliente "${options.clientName}" ya existe en el workspace destino, no se mueve nada`)
  }

  const channels = await source.findAll(contact.class.Channel, { attachedTo: organization._id })
  const members = await source.findAll(contact.class.Member, { attachedTo: organization._id })

  const people: Array<{ person: Person, channels: Channel[] }> = []
  for (const member of members) {
    const person = await source.findOne(contact.class.Person, { _id: member.contact as Ref<Person> })
    if (person === undefined) {
      logger.error(`El contacto ${member.contact} de "${options.clientName}" no existe, se omite`)
      continue
    }
    people.push({ person, channels: await source.findAll(contact.class.Channel, { attachedTo: person._id }) })
  }

  logger.log(
    `"${organization.name}": ${channels.length} canales, ${people.length} contactos` +
      (options.dryRun ? ' (simulado, no se movió nada)' : '')
  )
  if (options.dryRun) {
    return { organization: organization._id, channels: channels.length, contacts: people.length }
  }

  const newOrgId = await copyOrganization(target, organization, channels)
  for (const { person, channels: personChannels } of people) {
    await copyPerson(target, newOrgId, person, personChannels)
  }
  logger.log(`Copiado al destino como ${newOrgId}`)

  if (options.keepSource) {
    logger.log('El original queda en el workspace de origen: revisá el destino y borralo a mano')
    return { organization: newOrgId, channels: channels.length, contacts: people.length }
  }

  await removeFromSource(source, organization, channels, members, people)
  logger.log('Borrado del workspace de origen')

  return { organization: newOrgId, channels: channels.length, contacts: people.length }
}

async function copyOrganization (
  target: TxOperations,
  organization: Organization,
  channels: Channel[]
): Promise<Ref<Organization>> {
  const orgId = generateId<Organization>()
  const data: Data<Organization> = {
    name: organization.name,
    city: organization.city,
    avatarType: organization.avatarType,
    avatar: organization.avatar,
    members: 0,
    channels: 0,
    attachments: 0,
    comments: 0,
    description: null
  }
  await target.createDoc(contact.class.Organization, contact.space.Contacts, data, orgId)

  for (const channel of channels) {
    await target.addCollection(
      contact.class.Channel,
      contact.space.Contacts,
      orgId,
      contact.class.Organization,
      'channels',
      { provider: channel.provider, value: channel.value }
    )
  }
  return orgId
}

async function copyPerson (
  target: TxOperations,
  orgId: Ref<Organization>,
  person: Person,
  channels: Channel[]
): Promise<void> {
  const personId = generateId<Person>()
  const data: Data<Person> = {
    name: person.name,
    city: person.city,
    avatarType: person.avatarType,
    avatar: person.avatar,
    channels: 0,
    attachments: 0,
    comments: 0
  }
  await target.createDoc(contact.class.Person, contact.space.Contacts, data, personId)

  for (const channel of channels) {
    await target.addCollection(
      contact.class.Channel,
      contact.space.Contacts,
      personId,
      contact.class.Person,
      'channels',
      { provider: channel.provider, value: channel.value }
    )
  }

  await target.addCollection(
    contact.class.Member,
    contact.space.Contacts,
    orgId,
    contact.class.Organization,
    'members',
    { contact: personId }
  )
}

/**
 * Borra del origen la organización y todo lo que colgaba de ella.
 *
 * Las personas se borran también: en esta migración cada contacto pertenece a un solo cliente,
 * así que dejarlas sueltas sería basura. Si una persona estuviera en otra organización, se
 * conserva.
 */
async function removeFromSource (
  source: TxOperations,
  organization: Organization,
  channels: Channel[],
  members: Member[],
  people: Array<{ person: Person, channels: Channel[] }>
): Promise<void> {
  for (const { person, channels: personChannels } of people) {
    const otherMemberships = await source.findAll(contact.class.Member, { contact: person._id })
    const belongsElsewhere = otherMemberships.some((m) => m.attachedTo !== organization._id)
    if (belongsElsewhere) continue

    for (const channel of personChannels) {
      await source.remove(channel)
    }
    await source.remove(person)
  }

  for (const member of members) {
    await source.remove(member)
  }
  for (const channel of channels) {
    await source.remove(channel)
  }
  await source.remove(organization)
}
