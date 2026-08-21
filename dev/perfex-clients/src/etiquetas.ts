//
// Migración de las etiquetas del board.
//
// En Perfex una etiqueta es sólo un nombre (`tbltags`) y una fila por asignación (`tbltaggables`).
// En Huly cada nombre es un `TagElement` del workspace y cada asignación un `TagReference` colgado
// del documento etiquetado. El picker de Huly busca los `TagElement` por `targetClass` exacto, así
// que las etiquetas de tareas y las de proyectos son dos juegos separados aunque compartan nombre.
//
import core, {
  generateId,
  type AttachedData,
  type Class,
  type Doc,
  type Ref,
  type Space,
  type TxOperations
} from '@hcengineering/core'
import tags, { type TagElement, type TagReference } from '@hcengineering/tags'
import tracker, { type Issue, type Project } from '@hcengineering/tracker'

import { type Logger } from './import'
import { type PerfexReader, type PerfexTag, type PerfexTagAssignment } from './perfex'

/** Documentos por tanda al escribir, igual que en el resto de la migración. */
const UPDATE_BATCH = 25
/** Ids por consulta al preguntarle a Huly por documentos ya existentes. */
const QUERY_BATCH = 500
/** Colores disponibles en Huly: el color de una etiqueta es un índice en la paleta. */
const PALETTE_SIZE = 24

/** Una etiqueta del board con todo lo que hay que crearle en Huly. */
export interface EtiquetaPlanificada {
  /** Nombre visible: el primero que apareció con este nombre normalizado. */
  nombre: string
  color: number
  /** Ids de Perfex que caen en esta etiqueta; son varios cuando había duplicados de tipeo. */
  perfexIds: number[]
  /** Ids de tareas de Perfex que la llevan. */
  tareas: number[]
  /** Ids de proyectos de Perfex que la llevan. */
  proyectos: number[]
}

export interface PlanDeEtiquetas {
  /** Etiquetas que se migran, de más usadas a menos. */
  elementos: EtiquetaPlanificada[]
  /** Etiquetas que quedan fuera por el umbral de usos. */
  descartadas: EtiquetaPlanificada[]
}

export interface TagImportOptions {
  /** Proyectos de Huly ya creados, por id de proyecto de Perfex. */
  migratedProjects: Record<string, Ref<Project>>
  /** Tareas de Huly ya creadas, por id de tarea de Perfex. */
  migratedTasks: Record<string, Ref<Issue>>
  /** Etiquetas de tareas ya creadas, por id de etiqueta de Perfex. Se completa durante la corrida. */
  migratedTags: Record<string, Ref<TagElement>>
  /** Etiquetas de proyectos ya creadas, por id de etiqueta de Perfex. */
  migratedProjectTags: Record<string, Ref<TagElement>>
  /** Deja fuera las etiquetas con menos de estos usos en el board. */
  minUsos: number
  dryRun: boolean
  /** Se llama cuando hay avance que conviene persistir. */
  onProgress: () => void
}

/** Nombre comparable: sin espacios sobrantes y en minúsculas, para fundir duplicados de tipeo. */
export function normalizarNombre (name: string): string {
  return name.trim().toLowerCase()
}

/**
 * Color de una etiqueta, derivado del nombre.
 *
 * Repite el cálculo de `getColorNumberByText` de `@hcengineering/ui`, que no se puede importar acá
 * porque arrastra Svelte: la misma etiqueta sale del mismo color en los cuatro ambientes.
 *
 * @param nombre nombre visible de la etiqueta.
 * @returns índice en la paleta de Huly, entre 0 y 23.
 */
export function colorDeEtiqueta (nombre: string): number {
  const hash = nombre.split('').reduce((prev, char) => ((prev << 5) - prev + char.charCodeAt(0)) | 0, 0)
  return Math.abs(hash) % PALETTE_SIZE
}

/**
 * Arma el plan de migración de etiquetas a partir de lo que hay en el board.
 *
 * Funde las etiquetas que sólo se diferencian en mayúsculas o espacios, junta sus usos y separa las
 * que no llegan al umbral. Una asignación a una etiqueta que ya no existe se ignora.
 *
 * @param etiquetas filas de `tbltags`.
 * @param asignaciones filas de `tbltaggables` de tareas y proyectos.
 * @param minUsos usos mínimos para migrar una etiqueta; siempre al menos 1.
 * @returns qué etiquetas se migran y cuáles quedan fuera, ordenadas por uso.
 */
export function planificarEtiquetas (
  etiquetas: PerfexTag[],
  asignaciones: PerfexTagAssignment[],
  minUsos: number
): PlanDeEtiquetas {
  const umbral = Math.max(1, minUsos)

  const porNombre = new Map<string, EtiquetaPlanificada>()
  const porPerfexId = new Map<number, EtiquetaPlanificada>()

  for (const etiqueta of etiquetas) {
    const nombre = (etiqueta.name ?? '').trim()
    if (nombre === '') continue

    const clave = normalizarNombre(nombre)
    let planificada = porNombre.get(clave)
    if (planificada === undefined) {
      planificada = { nombre, color: colorDeEtiqueta(nombre), perfexIds: [], tareas: [], proyectos: [] }
      porNombre.set(clave, planificada)
    }
    planificada.perfexIds.push(etiqueta.id)
    porPerfexId.set(etiqueta.id, planificada)
  }

  for (const asignacion of asignaciones) {
    const planificada = porPerfexId.get(asignacion.tag_id)
    if (planificada === undefined) continue

    if (asignacion.rel_type !== 'task' && asignacion.rel_type !== 'project') continue
    // El board tiene filas repetidas: la misma etiqueta dos veces en el mismo documento.
    const destino = asignacion.rel_type === 'task' ? planificada.tareas : planificada.proyectos
    if (!destino.includes(asignacion.rel_id)) destino.push(asignacion.rel_id)
  }

  const usos = (e: EtiquetaPlanificada): number => e.tareas.length + e.proyectos.length
  const todas = [...porNombre.values()].sort((a, b) => {
    const diferencia = usos(b) - usos(a)
    return diferencia !== 0 ? diferencia : a.nombre.localeCompare(b.nombre)
  })

  return {
    elementos: todas.filter((e) => usos(e) >= umbral),
    descartadas: todas.filter((e) => usos(e) < umbral)
  }
}

/**
 * Crea en Huly las etiquetas del board y se las pone a las tareas y a los proyectos migrados.
 *
 * Corre después de los proyectos y las tareas, y se apoya sólo en el estado de la migración, así
 * que se puede volver a correr sola sobre un workspace ya migrado: las etiquetas ya creadas y las
 * asignaciones que ya existen se saltean.
 */
export async function importTags (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: TagImportOptions
): Promise<void> {
  const plan = planificarEtiquetas(await perfex.getTags(), await perfex.getTagAssignments(), options.minUsos)

  const asignacionesTarea = plan.elementos.reduce((acc, e) => acc + e.tareas.length, 0)
  const asignacionesProyecto = plan.elementos.reduce((acc, e) => acc + e.proyectos.length, 0)
  logger.log(
    `Etiquetas a migrar: ${plan.elementos.length} (${plan.descartadas.length} por debajo de ` +
      `${Math.max(1, options.minUsos)} uso(s)), con ${asignacionesTarea} usos en tareas y ` +
      `${asignacionesProyecto} en proyectos` +
      (options.dryRun ? ' (simulado)' : '')
  )

  if (options.dryRun) {
    logger.log('nombre,usos_tarea,usos_proyecto')
    for (const e of [...plan.elementos, ...plan.descartadas]) {
      logger.log(`${e.nombre.replace(/"/g, '""')},${e.tareas.length},${e.proyectos.length}`)
    }
    return
  }

  // 1. Un TagElement por nombre y por clase destino. El de tareas y el de proyectos son distintos
  //    porque el picker de Huly busca por targetClass exacto.
  let creados = 0
  for (const elemento of plan.elementos) {
    if (elemento.tareas.length > 0) {
      const creado = await asegurarElemento(client, elemento, tracker.class.Issue, options.migratedTags)
      if (creado) creados++
    }
    if (elemento.proyectos.length > 0) {
      const creado = await asegurarElemento(client, elemento, tracker.class.Project, options.migratedProjectTags)
      if (creado) creados++
    }
    options.onProgress()
  }
  logger.log(`Etiquetas creadas: ${creados}`)

  // 2. Las asignaciones, con el espacio de cada documento resuelto contra Huly.
  const pendientes: Array<{
    space: Ref<Space>
    attachedTo: Ref<Doc>
    attachedToClass: Ref<Class<Doc>>
    data: AttachedData<TagReference>
  }> = []

  const espacioPorTarea = await resolverEspacios(client, plan, options)

  for (const elemento of plan.elementos) {
    const tagTarea = elementoDe(elemento, options.migratedTags)
    if (tagTarea !== undefined) {
      for (const tareaPerfex of elemento.tareas) {
        const issueId = options.migratedTasks[String(tareaPerfex)]
        if (issueId === undefined) continue
        const space = espacioPorTarea.get(issueId)
        if (space === undefined) continue
        pendientes.push({
          space,
          attachedTo: issueId,
          attachedToClass: tracker.class.Issue,
          data: { title: elemento.nombre, color: elemento.color, tag: tagTarea }
        })
      }
    }

    const tagProyecto = elementoDe(elemento, options.migratedProjectTags)
    if (tagProyecto !== undefined) {
      for (const proyectoPerfex of elemento.proyectos) {
        const projectId = options.migratedProjects[String(proyectoPerfex)]
        if (projectId === undefined) continue
        pendientes.push({
          // Un proyecto es un espacio: su propio documento vive en el espacio de espacios.
          space: core.space.Space,
          attachedTo: projectId,
          attachedToClass: tracker.class.Project,
          data: { title: elemento.nombre, color: elemento.color, tag: tagProyecto }
        })
      }
    }
  }

  // 3. Las que ya estén puestas se saltean, para que una segunda corrida no duplique nada.
  const yaPuestas = await asignacionesExistentes(
    client,
    pendientes.map((p) => p.attachedTo)
  )
  const faltantes = pendientes.filter((p) => !yaPuestas.has(`${p.attachedTo}:${p.data.tag}`))

  logger.log(`Asignaciones de etiquetas a escribir: ${faltantes.length} de ${pendientes.length}`)

  let escritas = 0
  for (let i = 0; i < faltantes.length; i += UPDATE_BATCH) {
    const batch = faltantes.slice(i, i + UPDATE_BATCH)
    await Promise.all(
      batch.map(async ({ space, attachedTo, attachedToClass, data }) => {
        await client.addCollection(tags.class.TagReference, space, attachedTo, attachedToClass, 'labels', data)
      })
    )
    escritas += batch.length
    logger.log(`  ... ${escritas} de ${faltantes.length} etiquetas puestas`)
    options.onProgress()
  }
  logger.log(`Etiquetas puestas: ${escritas}`)

  options.onProgress()
}

/** El TagElement ya creado para esta etiqueta, si alguno de sus ids de Perfex está en el estado. */
function elementoDe (elemento: EtiquetaPlanificada, mapa: Record<string, Ref<TagElement>>): Ref<TagElement> | undefined {
  for (const id of elemento.perfexIds) {
    const ref = mapa[String(id)]
    if (ref !== undefined) return ref
  }
  return undefined
}

/**
 * Crea el TagElement de una etiqueta si todavía no existe y lo anota en el estado.
 *
 * @returns true si lo creó, false si ya estaba.
 */
async function asegurarElemento (
  client: TxOperations,
  elemento: EtiquetaPlanificada,
  targetClass: Ref<Class<Doc>>,
  mapa: Record<string, Ref<TagElement>>
): Promise<boolean> {
  const existente = elementoDe(elemento, mapa)
  if (existente !== undefined) {
    // Los duplicados de tipeo apuntan todos al mismo TagElement.
    for (const id of elemento.perfexIds) mapa[String(id)] = existente
    return false
  }

  const tagId = generateId<TagElement>()
  await client.createDoc(
    tags.class.TagElement,
    core.space.Workspace,
    {
      title: elemento.nombre,
      description: '',
      targetClass,
      color: elemento.color,
      category: tags.category.NoCategory
    },
    tagId
  )
  for (const id of elemento.perfexIds) mapa[String(id)] = tagId
  return true
}

/** Espacio de cada tarea migrada: el estado sólo guarda su id, no en qué proyecto quedó. */
async function resolverEspacios (
  client: TxOperations,
  plan: PlanDeEtiquetas,
  options: TagImportOptions
): Promise<Map<Ref<Issue>, Ref<Project>>> {
  const ids = new Set<Ref<Issue>>()
  for (const elemento of plan.elementos) {
    for (const tareaPerfex of elemento.tareas) {
      const issueId = options.migratedTasks[String(tareaPerfex)]
      if (issueId !== undefined) ids.add(issueId)
    }
  }

  const espacios = new Map<Ref<Issue>, Ref<Project>>()
  const lista = [...ids]
  for (let i = 0; i < lista.length; i += QUERY_BATCH) {
    const issues = await client.findAll(
      tracker.class.Issue,
      { _id: { $in: lista.slice(i, i + QUERY_BATCH) } },
      { projection: { _id: 1, space: 1 } }
    )
    for (const issue of issues) espacios.set(issue._id, issue.space)
  }
  return espacios
}

/** Claves `documento:etiqueta` de las asignaciones que ya existen en Huly. */
async function asignacionesExistentes (client: TxOperations, documentos: Array<Ref<Doc>>): Promise<Set<string>> {
  const puestas = new Set<string>()
  const lista = [...new Set(documentos)]
  for (let i = 0; i < lista.length; i += QUERY_BATCH) {
    const refs = await client.findAll(
      tags.class.TagReference,
      { attachedTo: { $in: lista.slice(i, i + QUERY_BATCH) } },
      { projection: { attachedTo: 1, tag: 1 } }
    )
    for (const ref of refs) puestas.add(`${ref.attachedTo}:${ref.tag}`)
  }
  return puestas
}
