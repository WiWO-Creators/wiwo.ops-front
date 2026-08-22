//
// Vaciar el workspace de todo lo que trajo la migración, para poder importar de nuevo desde cero.
//
// Borra los proyectos con todo su contenido, las empresas y las personas sin cuenta. No toca a la
// gente que ya usa Huly: quien tiene cuenta se conserva, porque no vino de Perfex.
//
import attachment from '@hcengineering/attachment'
import contact, { type Organization, type Person } from '@hcengineering/contact'
import { type Doc, type TxOperations } from '@hcengineering/core'
import tags from '@hcengineering/tags'
import tracker from '@hcengineering/tracker'

import { type Logger } from './import'
import { findDuplicatePersonUuids } from './migration-integrity'

export interface CleanOptions {
  /** Si es true no borra nada: sólo informa qué borraría. */
  dryRun: boolean
  /** Conteo confirmado por el operador; impide borrar si el workspace cambió desde la vista previa. */
  expected?: CleanResult
  /** Falla entre documentos cuando el operador pidió detener la limpieza. */
  assertRunning?: () => void
}

export interface CleanResult {
  projects: number
  issues: number
  organizations: number
  people: number
  attachments: number
  tags: number
  preservedPeople: number
}

/** Valida conteos recibidos desde un worker o un archivo persistido. */
export function isCleanResult (value: unknown): value is CleanResult {
  if (typeof value !== 'object' || value === null) return false
  const result = value as Record<keyof CleanResult, unknown>
  const keys: Array<keyof CleanResult> = [
    'projects',
    'issues',
    'organizations',
    'people',
    'attachments',
    'tags',
    'preservedPeople'
  ]
  return keys.every((key) => Number.isInteger(result[key]) && (result[key] as number) >= 0)
}

/**
 * Borra del workspace todo lo que crea la migración.
 *
 * Al borrar un proyecto, el servidor se lleva también sus tareas, componentes e hitos, así que no
 * hace falta recorrerlos: alcanza con contarlos para el informe.
 */
export async function cleanWorkspace (
  client: TxOperations,
  logger: Logger,
  options: CleanOptions
): Promise<CleanResult> {
  const projects = await client.findAll(tracker.class.Project, {})
  const issues = await client.findAll(tracker.class.Issue, {}, { projection: { _id: 1 } })
  const organizations = await client.findAll(contact.class.Organization, {})
  const allPeople = await client.findAll(contact.class.Person, {})
  const duplicateUsers = findDuplicatePersonUuids(allPeople)
  if (duplicateUsers.length > 0) {
    throw new Error(
      `No se puede limpiar: ${duplicateUsers.length} personUuid duplicados. ` +
        'Repara las personas con cuenta y sus referencias antes de borrar datos de negocio.'
    )
  }
  // Las personas con cuenta son gente real del equipo: no se tocan.
  const people = allPeople.filter((p) => p.personUuid === undefined)
  const removedIds = new Set([...projects, ...issues, ...organizations, ...people].map(({ _id }) => _id))
  const attachments = (await client.findAll(attachment.class.Attachment, {})).filter(({ attachedTo }) =>
    removedIds.has(attachedTo)
  )
  const tagElements = await client.findAll(tags.class.TagElement, {
    targetClass: { $in: [tracker.class.Project, tracker.class.Issue] }
  })

  logger.log(
    `A borrar: ${projects.length} proyectos (con sus ${issues.length} tareas), ` +
      `${organizations.length} empresas, ${people.length} personas sin cuenta, ` +
      `${attachments.length} adjuntos y ${tagElements.length} etiquetas` +
      (options.dryRun ? ' (simulado)' : '')
  )
  logger.log(`Se conservan ${allPeople.length - people.length} personas con cuenta`)

  const result: CleanResult = {
    projects: projects.length,
    issues: issues.length,
    organizations: organizations.length,
    people: people.length,
    attachments: attachments.length,
    tags: tagElements.length,
    preservedPeople: allPeople.length - people.length
  }
  assertPreviewMatches(result, options.expected)
  if (options.dryRun) return result

  await removeDocuments(client, attachments, 'Adjuntos borrados', logger, options.assertRunning)
  await removeDocuments(client, projects, 'Proyectos borrados', logger, options.assertRunning)

  for (let index = 0; index < organizations.length; index++) {
    options.assertRunning?.()
    await removeWithCollections(client, organizations[index])
    logger.log(`Empresas borradas: ${index + 1}/${organizations.length}`)
  }

  for (let index = 0; index < people.length; index++) {
    options.assertRunning?.()
    await removeWithCollections(client, people[index])
    logger.log(`Personas borradas: ${index + 1}/${people.length}`)
  }

  await removeDocuments(client, tagElements, 'Etiquetas borradas', logger, options.assertRunning)

  return result
}

/** Impide ejecutar una limpieza si los conteos cambiaron después de la vista previa confirmada. */
function assertPreviewMatches (actual: CleanResult, expected: CleanResult | undefined): void {
  if (expected === undefined) return
  const keys: Array<keyof CleanResult> = [
    'projects',
    'issues',
    'organizations',
    'people',
    'attachments',
    'tags',
    'preservedPeople'
  ]
  if (keys.every((key) => actual[key] === expected[key])) return
  throw new Error('El workspace cambió desde la vista previa. Genera una nueva antes de borrar.')
}

/** Borra documentos en serie y deja un evento después de cada operación completada. */
async function removeDocuments<T extends Doc> (
  client: TxOperations,
  documents: T[],
  label: string,
  logger: Logger,
  assertRunning: (() => void) | undefined
): Promise<void> {
  for (let index = 0; index < documents.length; index++) {
    assertRunning?.()
    await client.remove(documents[index])
    logger.log(`${label}: ${index + 1}/${documents.length}`)
  }
}

/** Borra un contacto junto con sus canales y sus vínculos con empresas. */
async function removeWithCollections (client: TxOperations, doc: Organization | Person): Promise<void> {
  const channels = await client.findAll(contact.class.Channel, { attachedTo: doc._id })
  for (const channel of channels) {
    await client.remove(channel)
  }

  const asMember = await client.findAll(contact.class.Member, { contact: doc._id })
  const ofOrganization = await client.findAll(contact.class.Member, { attachedTo: doc._id })
  for (const member of [...asMember, ...ofOrganization]) {
    await client.remove(member)
  }

  await client.remove(doc)
}
