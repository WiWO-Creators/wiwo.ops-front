//
// Alta en Huly de los clientes de Perfex.
//
// Cada cliente de Perfex se crea como organización, con su teléfono, su sitio web y su carpeta
// de Drive como canales de contacto, y sus contactos como personas asociadas a la organización.
//
import contact, {
  AvatarType,
  type ChannelProvider,
  type Contact,
  type Organization,
  type Person
} from '@hcengineering/contact'
import { generateId, type AccountUuid, type Class, type Data, type Ref, type TxOperations } from '@hcengineering/core'

import { type FileUploader } from '@hcengineering/importer'

import { belongsToEnvironment, type Environment } from './environments'
import {
  importTags,
  type Logger,
  type PerfexClient,
  type PerfexContact,
  type PerfexReader,
  type PerfexStaff
} from '@hcengineering/perfex'
import { importAttachments } from './adjuntos'
import {
  miembrosDeOrganizaciones,
  normalizarNombre,
  organizacionesPorNombre,
  personasPorEmail
} from './existente'
import { importColaboradores } from './colaboradores'
import { importMilestones, importProjects } from './proyectos'

export { type Logger }

/** Partes de la migración. Por defecto se corren todas, en este orden. */
export type Stage = 'personas' | 'clientes' | 'proyectos' | 'hitos' | 'etiquetas' | 'adjuntos' | 'colaboradores'

export const ALL_STAGES: Stage[] = [
  'personas',
  'clientes',
  'proyectos',
  'hitos',
  'etiquetas',
  'adjuntos',
  'colaboradores'
]

export interface ImportOptions {
  /** Ambiente destino: define qué clientes entran en esta corrida. */
  environment: Environment
  /** Partes a correr. */
  stages: Stage[]
  /** Si es true no escribe nada en Huly: sólo lee Perfex e informa qué haría. */
  dryRun: boolean
  /** Si es true migra también los clientes marcados como inactivos en Perfex. */
  includeInactive: boolean
  /** Sólo tareas creadas desde esta fecha (timestamp). Sin valor, todas. */
  tasksSince?: number
  /** Sólo tareas creadas antes de esta fecha (timestamp). Sin valor, sin tope. */
  tasksUntil?: number
  /** Si es true deja fuera las tareas ya completadas en Perfex. */
  onlyOpenTasks: boolean
  /** Deja fuera las etiquetas con menos de estos usos en el board. */
  minTagUses: number
  /** Carpeta con los archivos rescatados del board. Sin ella la etapa de adjuntos se saltea. */
  attachmentsDir?: string
  /** Si es true migra también los colaboradores de las tareas ya completadas en el board. */
  includeClosedTaskCollaborators: boolean
}

/** Nombre visible de un contacto, con respaldo al email cuando no tiene nombre cargado. */
export function buildContactName (contact_: PerfexContact): string {
  const name = `${contact_.firstName} ${contact_.lastName}`.trim()
  if (name !== '') return name
  return contact_.email !== '' ? contact_.email : `Contacto ${contact_.id}`
}

/**
 * Migra los clientes del ambiente indicado.
 *
 * @param client cliente de Huly ya autenticado contra el workspace destino.
 */
export async function importClients (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions,
  uploader?: FileUploader,
  ensurePerson?: (email: string, firstName: string, lastName: string) => Promise<Ref<Person>>
): Promise<void> {
  const stages = new Set(options.stages)

  const all = await perfex.getClients()
  const clients = all
    .filter((c) => belongsToEnvironment(c.groups, options.environment))
    .filter((c) => options.includeInactive || c.active)

  const contactCount = clients.reduce((acc, c) => acc + c.contacts.length, 0)
  logger.log(
    `Ambiente ${options.environment.label}: ${clients.length} de ${all.length} clientes ` +
      `y ${contactCount} contactos`
  )

  const staff = await perfex.getStaff()
  const peopleByStaffId = await runStaffStage(logger, options, stages, staff, ensurePerson)
  const organizationsByClientId = await runClientsStage(client, logger, options, stages, clients)

  await runProjectsStage(client, perfex, logger, options, clients, peopleByStaffId, organizationsByClientId, uploader)
  await runMilestonesStage(client, perfex, logger, options)
  await runTagsStage(client, perfex, logger, options)
  await runAttachmentsStage(client, perfex, logger, options, clients, uploader)
  await runColaboradoresStage(client, perfex, logger, options)

  if (options.dryRun) {
    logger.log('Simulación: no se escribió nada en Huly')
  }
}

/**
 * Da de alta al staff del board como personas de ops y devuelve con qué persona quedó cada uno.
 *
 * Siempre se resuelve el staff completo, corra o no la etapa: las tareas necesitan saber a quién
 * asignarse. `ensurePerson` reusa la persona que ya tenga ese correo, así que repetirlo no duplica
 * a nadie.
 */
async function runStaffStage (
  logger: Logger,
  options: ImportOptions,
  stages: Set<Stage>,
  staff: PerfexStaff[],
  ensurePerson?: (email: string, firstName: string, lastName: string) => Promise<Ref<Person>>
): Promise<Record<string, Ref<Person>>> {
  const peopleByStaffId: Record<string, Ref<Person>> = {}
  if (options.dryRun || ensurePerson === undefined) {
    if (stages.has('personas')) {
      logger.log(`Staff: ${staff.filter((p) => p.email.trim() !== '').length} personas (simulado)`)
    }
    return peopleByStaffId
  }

  let resueltas = 0
  for (const person of staff) {
    const email = person.email.trim()
    if (email === '') {
      logger.error(`Staff ${person.staffid} sin correo, se omite`)
      continue
    }
    peopleByStaffId[person.staffid] = await ensurePerson(email, person.firstname.trim(), person.lastname.trim())
    resueltas++
  }
  logger.log(`Staff: ${resueltas} personas resueltas`)
  return peopleByStaffId
}

/**
 * Crea las organizaciones y los contactos que falten, y devuelve la organización de cada cliente.
 *
 * Las organizaciones se reconocen por nombre y las personas por correo, así que una segunda corrida
 * no duplica nada y sí trae los contactos que se hayan cargado en el board desde la vez anterior.
 * El mapa se devuelve completo aunque la etapa no corra: los proyectos lo necesitan para vincular
 * cada campaña con su cliente.
 */
async function runClientsStage (
  client: TxOperations,
  logger: Logger,
  options: ImportOptions,
  stages: Set<Stage>,
  clients: PerfexClient[]
): Promise<Record<string, Ref<Organization>>> {
  const organizationsByClientId: Record<string, Ref<Organization>> = {}
  if (options.dryRun) {
    if (stages.has('clientes')) {
      logger.log(`Organizaciones: ${clients.length} clientes a revisar (simulado)`)
    }
    return organizationsByClientId
  }

  const existentes = await organizacionesPorNombre(client)
  const emails = clients.flatMap((c) => c.contacts.map((p) => p.email))
  const personasExistentes = await personasPorEmail(client, emails)

  let creadas = 0
  let reusadas = 0
  const nuevas: Array<{ perfexClient: PerfexClient, orgId: Ref<Organization> }> = []

  for (const perfexClient of clients) {
    if (perfexClient.company === '') {
      logger.error(`Cliente ${perfexClient.id} sin nombre de empresa, se omite`)
      continue
    }

    const yaExiste = existentes.get(normalizarNombre(perfexClient.company))
    if (yaExiste !== undefined) {
      organizationsByClientId[perfexClient.id] = yaExiste
      reusadas++
      continue
    }
    if (!stages.has('clientes')) continue

    const orgId = await createOrganization(client, perfexClient)
    organizationsByClientId[perfexClient.id] = orgId
    existentes.set(normalizarNombre(perfexClient.company), orgId)
    nuevas.push({ perfexClient, orgId })
    creadas++
  }

  if (!stages.has('clientes')) return organizationsByClientId

  logger.log(`Organizaciones: ${creadas} nuevas, ${reusadas} ya existían`)

  // Los contactos se revisan para todos los clientes, no sólo para los nuevos: el board sigue vivo
  // hasta el corte y una persona cargada después de la primera corrida tiene que viajar igual.
  const orgIds = Object.values(organizationsByClientId)
  const miembros = await miembrosDeOrganizaciones(client, orgIds)

  let contactosCreados = 0
  let contactosVinculados = 0
  for (const perfexClient of clients) {
    const orgId = organizationsByClientId[perfexClient.id]
    if (orgId === undefined) continue

    for (const perfexContact of perfexClient.contacts) {
      const email = perfexContact.email.trim().toLowerCase()
      let personId = email !== '' ? personasExistentes.get(email) : undefined

      if (personId === undefined) {
        personId = await createPerson(client, perfexContact)
        if (email !== '') personasExistentes.set(email, personId)
        contactosCreados++
      }

      if (miembros.has(`${orgId}:${personId}`)) continue
      await linkContactToOrganization(client, orgId, personId)
      miembros.add(`${orgId}:${personId}`)
      contactosVinculados++
    }
  }
  logger.log(`Contactos: ${contactosCreados} nuevos, ${contactosVinculados} vinculados a su empresa`)

  if (nuevas.length > 0) {
    const ejemplo = nuevas[0].perfexClient
    logger.log(`Ejemplo de alta: "${ejemplo.company}" con ${ejemplo.contacts.length} contactos`)
  }
  return organizationsByClientId
}

/** Corre la parte de hitos, si está pedida. Necesita los proyectos y las tareas ya migrados. */
async function runMilestonesStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions
): Promise<void> {
  if (!options.stages.includes('hitos')) return

  await importMilestones(client, perfex, logger, { dryRun: options.dryRun })
}

/**
 * Corre la parte de etiquetas, si está pedida.
 *
 * Encuentra las tareas y los proyectos por su `perfexId`, no por el archivo de estado: es la misma
 * función que corre sola en el despliegue, desde la migración del modelo.
 */
async function runTagsStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions
): Promise<void> {
  if (!options.stages.includes('etiquetas')) return

  await importTags(client, perfex, logger, {
    minUsos: options.minTagUses,
    dryRun: options.dryRun
  })
}

/**
 * Corre la parte de colaboradores, si está pedida.
 *
 * Va después de las tareas: escribe sobre las que ya están migradas, buscándolas por su `perfexId`.
 */
async function runColaboradoresStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions
): Promise<void> {
  if (!options.stages.includes('colaboradores')) return

  await importColaboradores(client, perfex, logger, {
    dryRun: options.dryRun,
    includeClosedTasks: options.includeClosedTaskCollaborators
  })
}

/**
 * Corre la carga de adjuntos, si está pedida.
 *
 * Necesita la carpeta con los archivos rescatados del board: sin ella no hay nada que subir, así
 * que avisa y sigue en vez de cortar la corrida completa.
 */
async function runAttachmentsStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions,
  clients: PerfexClient[],
  uploader?: FileUploader
): Promise<void> {
  if (!options.stages.includes('adjuntos')) return

  const dir = options.attachmentsDir
  if (dir === undefined || dir === '') {
    logger.log('Adjuntos: se saltea, falta la carpeta del rescate (--dir-adjuntos)')
    return
  }
  if (uploader === undefined && !options.dryRun) {
    throw new Error('Falta el subidor de archivos para migrar los adjuntos')
  }

  await importAttachments(client, uploader as FileUploader, perfex, logger, {
    dir,
    clients: clients.map((c) => ({ id: c.id, company: c.company })),
    dryRun: options.dryRun
  })
}

/** Corre la parte de proyectos, tareas y comentarios, si está pedida. */
async function runProjectsStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions,
  clients: PerfexClient[],
  peopleByStaffId: Record<string, Ref<Person>>,
  organizationsByClientId: Record<string, Ref<Organization>>,
  uploader?: FileUploader
): Promise<void> {
  if (!options.stages.includes('proyectos')) return
  if (uploader === undefined && !options.dryRun) {
    throw new Error('Falta el subidor de archivos para migrar proyectos y tareas')
  }

  // Los proyectos nacen privados y sin miembros: el reparto lo hace después el comando `permisos`.
  await importProjects(client, uploader as FileUploader, perfex, logger, {
    clients: clients.map((c) => ({ id: c.id, company: c.company })),
    isOrphanEnvironment: options.environment.groups.length === 0,
    peopleByStaffId,
    organizationsByClientId,
    tasksSince: options.tasksSince,
    tasksUntil: options.tasksUntil,
    onlyOpenTasks: options.onlyOpenTasks,
    dryRun: options.dryRun
  })
}

async function createOrganization (client: TxOperations, perfexClient: PerfexClient): Promise<Ref<Organization>> {
  const orgId = generateId<Organization>()
  const data: Data<Organization> = {
    name: perfexClient.company,
    city: perfexClient.city,
    avatarType: AvatarType.COLOR,
    members: 0,
    channels: 0,
    attachments: 0,
    comments: 0,
    description: null
  }
  await client.createDoc(contact.class.Organization, contact.space.Contacts, data, orgId)

  await addChannel(client, orgId, contact.class.Organization, contact.channelProvider.Phone, perfexClient.phone)
  await addChannel(client, orgId, contact.class.Organization, contact.channelProvider.Homepage, perfexClient.website)
  // La carpeta de Drive no tiene un canal propio en Huly: va como enlace, junto al sitio web.
  await addChannel(client, orgId, contact.class.Organization, contact.channelProvider.Homepage, perfexClient.driveLink)

  return orgId
}

/** Crea la persona de contacto, con su correo y su teléfono como canales. */
async function createPerson (client: TxOperations, perfexContact: PerfexContact): Promise<Ref<Person>> {
  const personId = generateId<Person>()
  const data: Data<Person> = {
    name: buildContactName(perfexContact),
    avatarType: AvatarType.COLOR,
    city: '',
    channels: 0,
    attachments: 0,
    comments: 0
  }
  await client.createDoc(contact.class.Person, contact.space.Contacts, data, personId)

  await addChannel(client, personId, contact.class.Person, contact.channelProvider.Email, perfexContact.email)
  await addChannel(client, personId, contact.class.Person, contact.channelProvider.Phone, perfexContact.phone)

  return personId
}

/**
 * Asocia una persona a la organización como miembro.
 *
 * Va separado del alta porque la misma persona puede ser contacto de más de una empresa, y porque
 * una corrida repetida tiene que poder vincular a alguien que ya existe.
 */
async function linkContactToOrganization (
  client: TxOperations,
  orgId: Ref<Organization>,
  personId: Ref<Person>
): Promise<void> {
  await client.addCollection(
    contact.class.Member,
    contact.space.Contacts,
    orgId,
    contact.class.Organization,
    'members',
    { contact: personId }
  )
}

/**
 * Cuentas de las personas que ya usan el workspace.
 *
 * Se toman los empleados activos, que son las personas con cuenta: los contactos migrados desde
 * Perfex no tienen cuenta todavía y no cuentan como miembros.
 */
export async function getWorkspaceMembers (client: TxOperations): Promise<AccountUuid[]> {
  const employees = await client.findAll(contact.mixin.Employee, { active: true })
  return employees.map((e) => e.personUuid).filter((uuid): uuid is AccountUuid => uuid !== undefined)
}

/** Agrega un canal de contacto (teléfono, web, email), si el valor no está vacío. */
async function addChannel (
  client: TxOperations,
  attachedTo: Ref<Contact>,
  attachedToClass: Ref<Class<Contact>>,
  provider: Ref<ChannelProvider>,
  value: string | undefined
): Promise<void> {
  if (value === undefined || value.trim() === '') return
  await client.addCollection(contact.class.Channel, contact.space.Contacts, attachedTo, attachedToClass, 'channels', {
    provider,
    value: value.trim()
  })
}
