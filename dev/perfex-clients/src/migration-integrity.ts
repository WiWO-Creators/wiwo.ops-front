import contact, { type Person } from '@hcengineering/contact'
import core, { type PersonUuid, type Ref, type TxOperations } from '@hcengineering/core'

export interface DuplicatePersonUuid {
  personUuid: PersonUuid
  people: Array<Ref<Person>>
}

/** Agrupa personas locales repetidas que apuntan a la misma persona global. */
export function findDuplicatePersonUuids (
  people: Array<Pick<Person, '_id' | 'personUuid'>>
): DuplicatePersonUuid[] {
  const byPersonUuid = new Map<PersonUuid, Array<Ref<Person>>>()
  for (const person of people) {
    if (person.personUuid === undefined) continue
    const refs = byPersonUuid.get(person.personUuid) ?? []
    refs.push(person._id)
    byPersonUuid.set(person.personUuid, refs)
  }
  return [...byPersonUuid.entries()]
    .filter(([, refs]) => refs.length > 1)
    .map(([personUuid, refs]) => ({ personUuid, people: refs }))
}

/** Bloquea cualquier etapa si faltan invariantes que volverían inseguro reintentar. */
export async function assertMigrationIntegrity (client: TxOperations): Promise<void> {
  const contactsSpace = await client.findOne(core.class.Space, { _id: contact.space.Contacts })
  if (contactsSpace === undefined || contactsSpace._class !== core.class.SystemSpace) {
    throw new Error(
      'Integridad del workspace: falta contact:space:Contacts como SystemSpace. ' +
      'La etapa se detuvo antes de escribir; actualiza el modelo del workspace y reintenta.'
    )
  }

  const people = await client.findAll(
    contact.class.Person,
    {},
    { projection: { _id: 1, personUuid: 1 } }
  )
  const duplicates = findDuplicatePersonUuids(people)
  if (duplicates.length === 0) return

  const extraPeople = duplicates.reduce((total, duplicate) => total + duplicate.people.length - 1, 0)
  const examples = duplicates
    .slice(0, 5)
    .map(({ personUuid, people }) => `${personUuid}×${people.length}`)
    .join(', ')
  throw new Error(
    `Integridad del workspace: ${duplicates.length} personUuid duplicados ` +
    `(${extraPeople} personas extra). La etapa se detuvo antes de escribir. ` +
    'No reintentes ni uses limpiar: ese comando conserva personas con personUuid. ' +
    `Ejecuta la reparación auditada de duplicados y verifica referencias. Ejemplos: ${examples}`
  )
}
