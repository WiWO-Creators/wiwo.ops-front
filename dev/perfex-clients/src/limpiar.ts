//
// Vaciar el workspace de todo lo que trajo la migración, para poder importar de nuevo desde cero.
//
// Borra los proyectos con todo su contenido, las empresas y las personas sin cuenta. No toca a la
// gente que ya usa Huly: quien tiene cuenta se conserva, porque no vino de Perfex.
//
import contact, { type Organization, type Person } from '@hcengineering/contact'
import { type TxOperations } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { type Logger } from './import'

export interface CleanOptions {
  /** Si es true no borra nada: sólo informa qué borraría. */
  dryRun: boolean
}

export interface CleanResult {
  projects: number
  issues: number
  organizations: number
  people: number
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
  // Las personas con cuenta son gente real del equipo: no se tocan.
  const people = allPeople.filter((p) => p.personUuid === undefined)

  logger.log(
    `A borrar: ${projects.length} proyectos (con sus ${issues.length} tareas), ` +
      `${organizations.length} empresas y ${people.length} personas sin cuenta` +
      (options.dryRun ? ' (simulado)' : '')
  )
  logger.log(`Se conservan ${allPeople.length - people.length} personas con cuenta`)

  const result: CleanResult = {
    projects: projects.length,
    issues: issues.length,
    organizations: organizations.length,
    people: people.length
  }
  if (options.dryRun) return result

  for (const project of projects) {
    await client.remove(project)
  }
  logger.log(`Proyectos borrados: ${projects.length}`)

  for (const organization of organizations) {
    await removeWithCollections(client, organization)
  }
  logger.log(`Empresas borradas: ${organizations.length}`)

  for (const person of people) {
    await removeWithCollections(client, person)
  }
  logger.log(`Personas borradas: ${people.length}`)

  return result
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
