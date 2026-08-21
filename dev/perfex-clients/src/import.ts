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
import { readFileSync, writeFileSync } from 'fs'

import { type FileUploader } from '@hcengineering/importer'
import { type Issue, type Milestone, type Project } from '@hcengineering/tracker'

import { belongsToEnvironment, type Environment } from './environments'
import {
  importTags,
  type Logger,
  type PerfexClient,
  type PerfexContact,
  type PerfexReader
} from '@hcengineering/perfex'
import { importAttachments } from './adjuntos'
import { importMilestones, importProjects } from './proyectos'

export { type Logger }

/** Partes de la migración. Por defecto se corren todas, en este orden. */
export type Stage = 'personas' | 'clientes' | 'proyectos' | 'hitos' | 'etiquetas' | 'adjuntos'

export const ALL_STAGES: Stage[] = ['personas', 'clientes', 'proyectos', 'hitos', 'etiquetas', 'adjuntos']

export interface ImportOptions {
  /** Ambiente destino: define qué clientes entran en esta corrida. */
  environment: Environment
  /** Partes a correr. */
  stages: Stage[]
  /** Si es true no escribe nada en Huly: sólo lee Perfex e informa qué haría. */
  dryRun: boolean
  /** Archivo JSON donde se guarda el mapeo Perfex → Huly, para poder repetir la corrida. */
  statePath: string
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
}

/** Mapeo de lo ya migrado, para que una segunda corrida no duplique documentos. */
interface MigrationState {
  organizaciones: Record<string, Ref<Organization>>
  personas: Record<string, Ref<Person>>
  /** Personas del staff de Perfex, por staffid. */
  staff: Record<string, Ref<Person>>
  /** Proyectos de Huly, por id de proyecto de Perfex (`cliente-<id>` y `orphan` para el resto). */
  proyectos: Record<string, Ref<Project>>
  tareas: Record<string, Ref<Issue>>
  /** Hitos de Huly, por id de hito de Perfex. */
  hitos: Record<string, Ref<Milestone>>
}

const EMPTY_STATE: MigrationState = {
  organizaciones: {},
  personas: {},
  staff: {},
  proyectos: {},
  tareas: {},
  hitos: {}
}

function loadState (path: string): MigrationState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch (err: any) {
    if (err.code === 'ENOENT') return { ...EMPTY_STATE }
    throw err
  }
}

function saveState (path: string, state: MigrationState): void {
  writeFileSync(path, JSON.stringify(state, null, 2))
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
  const state = loadState(options.statePath)
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

  // --- Staff: las personas a las que se les asignan tareas -------------------------------------
  if (stages.has('personas') && ensurePerson !== undefined) {
    const staff = await perfex.getStaff()
    let people = 0
    for (const person of staff) {
      if (state.staff[person.staffid] !== undefined) continue
      const email = person.email.trim()
      if (email === '') {
        logger.error(`Staff ${person.staffid} sin correo, se omite`)
        continue
      }
      if (!options.dryRun) {
        state.staff[person.staffid] = await ensurePerson(email, person.firstname.trim(), person.lastname.trim())
      }
      people++
    }
    logger.log(`Staff: ${people} personas nuevas${options.dryRun ? ' (simulado)' : ''}`)
    if (!options.dryRun) saveState(options.statePath, state)
  }

  if (!stages.has('clientes')) {
    await runProjectsStage(client, perfex, logger, options, state, clients, uploader)
    await runMilestonesStage(client, perfex, logger, options, state)
    await runTagsStage(client, perfex, logger, options)
    await runAttachmentsStage(client, perfex, logger, options, clients, uploader)
    return
  }

  let created = 0
  let skipped = 0
  let contactsCreated = 0

  for (const perfexClient of clients) {
    if (state.organizaciones[perfexClient.id] !== undefined) {
      skipped++
      continue
    }
    if (perfexClient.company === '') {
      logger.error(`Cliente ${perfexClient.id} sin nombre de empresa, se omite`)
      continue
    }

    if (options.dryRun) {
      created++
      contactsCreated += perfexClient.contacts.length
      continue
    }

    const orgId = await createOrganization(client, perfexClient)
    state.organizaciones[perfexClient.id] = orgId
    created++

    for (const perfexContact of perfexClient.contacts) {
      if (state.personas[perfexContact.id] !== undefined) continue
      state.personas[perfexContact.id] = await createContact(client, orgId, perfexContact)
      contactsCreated++
    }

    // Se guarda cliente a cliente: si la corrida se corta, lo hecho no se repite.
    saveState(options.statePath, state)
  }

  const suffix = options.dryRun ? ' (simulado)' : ''
  logger.log(`Organizaciones: ${created} nuevas, ${skipped} ya existían${suffix}`)
  logger.log(`Contactos: ${contactsCreated} nuevos${suffix}`)

  if (options.dryRun) {
    const sample = clients.find((c) => c.contacts.length > 0 || c.driveLink !== undefined)
    if (sample !== undefined) {
      logger.log(
        `Ejemplo: "${sample.company}" | grupos: ${sample.groups.length > 0 ? sample.groups.join(' / ') : '-'} ` +
          `| contactos: ${sample.contacts.length} | drive: ${sample.driveLink ?? '-'}`
      )
    }
  }

  await runProjectsStage(client, perfex, logger, options, state, clients, uploader)
  await runMilestonesStage(client, perfex, logger, options, state)
  await runTagsStage(client, perfex, logger, options)
  await runAttachmentsStage(client, perfex, logger, options, clients, uploader)

  if (options.dryRun) {
    logger.log('Simulación: no se escribió nada en Huly')
  }
}

/** Corre la parte de hitos, si está pedida. Necesita los proyectos y las tareas ya migrados. */
async function runMilestonesStage (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: ImportOptions,
  state: MigrationState
): Promise<void> {
  if (!options.stages.includes('hitos')) return

  await importMilestones(client, perfex, logger, {
    migratedProjects: state.proyectos,
    migratedTasks: state.tareas,
    migratedMilestones: state.hitos,
    dryRun: options.dryRun,
    onProgress: () => {
      saveState(options.statePath, state)
    }
  })
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
  state: MigrationState,
  clients: PerfexClient[],
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
    peopleByStaffId: state.staff,
    organizationsByClientId: state.organizaciones,
    migratedProjects: state.proyectos,
    migratedTasks: state.tareas,
    tasksSince: options.tasksSince,
    tasksUntil: options.tasksUntil,
    onlyOpenTasks: options.onlyOpenTasks,
    dryRun: options.dryRun,
    onProgress: () => {
      saveState(options.statePath, state)
    }
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

/** Crea la persona de contacto y la asocia a la organización como miembro. */
async function createContact (
  client: TxOperations,
  orgId: Ref<Organization>,
  perfexContact: PerfexContact
): Promise<Ref<Person>> {
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

  await client.addCollection(
    contact.class.Member,
    contact.space.Contacts,
    orgId,
    contact.class.Organization,
    'members',
    { contact: personId }
  )

  return personId
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
