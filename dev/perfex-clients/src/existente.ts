//
// Qué de la migración ya está en ops.
//
// La migración se corre varias veces —por tandas, después de un corte, o de nuevo el día del
// cierre del board— y tiene que crear sólo lo que falta. La verdad de qué existe se pregunta al
// workspace, nunca a un archivo local: el archivo se pierde, se queda viejo o vive en otra
// máquina, y cuando eso pasa la corrida siguiente duplica todo.
//
// Cada documento se reconoce por un ancla estable:
//
// | Documento | Ancla |
// |---|---|
// | Organización | nombre de la empresa |
// | Persona de contacto | dirección de correo |
// | Proyecto de campaña | `perfexId` |
// | Proyecto de tareas sueltas | nombre del proyecto |
// | Tarea | `perfexId` |
// | Comentario | tarea y fecha de alta |
// | Hito | proyecto y nombre |
//
import chunter, { type ChatMessage } from '@hcengineering/chunter'
import contact, { type Organization, type Person } from '@hcengineering/contact'
import { type Ref, type TxOperations } from '@hcengineering/core'
import { tareasPorPerfexId } from '@hcengineering/perfex'
import { type Issue, type Milestone, type Project } from '@hcengineering/tracker'
import tracker from '@hcengineering/tracker'

// La búsqueda de tareas por su id de Perfex vive en el paquete compartido, porque también la usa
// la migración de etiquetas que corre sola en cada despliegue.
export { tareasPorPerfexId }

/** Cuántos ids entran en una consulta. Más alto empieza a pesar en el transactor. */
const QUERY_BATCH = 500

/** Recorre `ids` en lotes y junta lo que devuelve cada consulta. */
async function porLotes<T, R> (ids: T[], consulta: (lote: T[]) => Promise<R[]>): Promise<R[]> {
  const unicos = [...new Set(ids)]
  const encontrados: R[] = []
  for (let i = 0; i < unicos.length; i += QUERY_BATCH) {
    encontrados.push(...(await consulta(unicos.slice(i, i + QUERY_BATCH))))
  }
  return encontrados
}

/**
 * Nombre de empresa normalizado, para reconocer la misma organización aunque cambie el formato.
 *
 * Perfex y ops guardan el nombre tal como lo escribió cada quien: sobra un espacio, cambia una
 * mayúscula. Comparar en crudo crearía una empresa nueva por cada diferencia de tipeo.
 */
export function normalizarNombre (nombre: string): string {
  return nombre.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** Organizaciones del workspace, por nombre normalizado. */
export async function organizacionesPorNombre (
  client: TxOperations,
  canonicos: Record<string, string> = {}
): Promise<Map<string, Ref<Organization>>> {
  const organizaciones = await client.findAll(
    contact.class.Organization,
    {},
    { projection: { _id: 1, name: 1 } }
  )
  const porNombre = new Map<string, Ref<Organization>>()
  for (const organizacion of organizaciones) {
    // La primera gana: si una corrida vieja dejó duplicados, no se reparten los contactos entre
    // las dos copias.
    const clave = normalizarNombre(organizacion.name)
    if (canonicos[clave] === organizacion._id || !porNombre.has(clave)) porNombre.set(clave, organizacion._id)
  }
  return porNombre
}

/**
 * Personas del workspace que tienen alguno de estos correos, por correo en minúsculas.
 *
 * El correo vive en un canal, no en la persona, así que se busca por canal y se devuelve a quién
 * está pegado.
 */
export async function personasPorEmail (
  client: TxOperations,
  emails: string[],
  canonicos: Record<string, string> = {}
): Promise<Map<string, Ref<Person>>> {
  const buscados = emails.map((e) => e.trim().toLowerCase()).filter((e) => e !== '')
  const canales = await porLotes(buscados, async (lote) =>
    await client.findAll(
      contact.class.Channel,
      { provider: contact.channelProvider.Email, value: { $in: lote } },
      { projection: { _id: 1, value: 1, attachedTo: 1 } }
    )
  )

  const porEmail = new Map<string, Ref<Person>>()
  for (const canal of canales) {
    const clave = canal.value.trim().toLowerCase()
    if (canonicos[clave] === canal.attachedTo || !porEmail.has(clave)) {
      porEmail.set(clave, canal.attachedTo as Ref<Person>)
    }
  }
  return porEmail
}

/** Personas que ya figuran como miembros de estas organizaciones, en claves `organización:persona`. */
export async function miembrosDeOrganizaciones (
  client: TxOperations,
  orgIds: Array<Ref<Organization>>
): Promise<Set<string>> {
  const miembros = await porLotes(orgIds, async (lote) =>
    await client.findAll(
      contact.class.Member,
      { attachedTo: { $in: lote } },
      { projection: { _id: 1, attachedTo: 1, contact: 1 } }
    )
  )
  return new Set(miembros.map((m) => `${m.attachedTo}:${m.contact}`))
}

/** Proyectos migrados del workspace, por id de proyecto de Perfex. */
export async function proyectosPorPerfexId (
  client: TxOperations,
  idsDeProyecto: number[]
): Promise<Map<number, Ref<Project>>> {
  const proyectos = await porLotes(idsDeProyecto, async (lote) =>
    await client.findAll(
      tracker.class.Project,
      { perfexId: { $in: lote } },
      { projection: { _id: 1, perfexId: 1 } }
    )
  )
  const encontrados = new Map<number, Ref<Project>>()
  for (const proyecto of proyectos) {
    if (proyecto.perfexId === undefined) continue
    encontrados.set(proyecto.perfexId, proyecto._id)
  }
  return encontrados
}

/**
 * Proyectos del workspace por nombre normalizado.
 *
 * Es el ancla de los dos proyectos que no salen de una campaña y por lo tanto no tienen id de
 * Perfex: el de tareas sueltas de un cliente y el de tareas huérfanas.
 */
export async function proyectosPorNombre (client: TxOperations): Promise<Map<string, Ref<Project>>> {
  const proyectos = await client.findAll(tracker.class.Project, {}, { projection: { _id: 1, name: 1 } })
  const porNombre = new Map<string, Ref<Project>>()
  for (const proyecto of proyectos) {
    const clave = normalizarNombre(proyecto.name)
    if (!porNombre.has(clave)) porNombre.set(clave, proyecto._id)
  }
  return porNombre
}

/**
 * Comentarios ya migrados de estas tareas, en claves `tarea:fecha`.
 *
 * El comentario migrado no guarda el id de Perfex, pero sí la fecha de alta del original, que el
 * importador escribe como fecha del mensaje. Tarea más fecha alcanza para no traer dos veces el
 * mismo comentario.
 */
export async function comentariosPorTareaYFecha (
  client: TxOperations,
  issueIds: Array<Ref<Issue>>
): Promise<Set<string>> {
  const mensajes = await porLotes(issueIds, async (lote) =>
    await client.findAll<ChatMessage>(
      chunter.class.ChatMessage,
      { attachedTo: { $in: lote } },
      { projection: { _id: 1, attachedTo: 1, createdOn: 1 } }
    )
  )
  return new Set(mensajes.map((m) => claveDeComentario(m.attachedTo as Ref<Issue>, m.createdOn)))
}

/** Clave con la que se reconoce un comentario ya migrado. */
export function claveDeComentario (issueId: Ref<Issue>, fecha: number | undefined): string {
  return `${issueId}:${fecha ?? 0}`
}

/** Hitos ya creados en estos proyectos, en claves `proyecto:nombre normalizado`. */
export async function hitosPorProyectoYNombre (
  client: TxOperations,
  projectIds: Array<Ref<Project>>
): Promise<Map<string, Ref<Milestone>>> {
  const hitos = await porLotes(projectIds, async (lote) =>
    await client.findAll(
      tracker.class.Milestone,
      { space: { $in: lote } },
      { projection: { _id: 1, space: 1, label: 1 } }
    )
  )
  const porClave = new Map<string, Ref<Milestone>>()
  for (const hito of hitos) {
    const clave = claveDeHito(hito.space, hito.label)
    if (!porClave.has(clave)) porClave.set(clave, hito._id)
  }
  return porClave
}

/** Clave con la que se reconoce un hito ya creado. */
export function claveDeHito (projectId: Ref<Project>, nombre: string): string {
  return `${projectId}:${normalizarNombre(nombre)}`
}
