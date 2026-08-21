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

import { type Logger } from './logger'
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
  /** Deja fuera las etiquetas con menos de estos usos en el board. */
  minUsos: number
  /** Si es true no escribe nada: sólo informa qué haría y saca el listado de etiquetas. */
  dryRun: boolean
  /** Se llama cuando hay avance que conviene persistir. */
  onProgress?: () => void
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
 * Encuentra cada documento por su `perfexId`, así que no necesita el archivo de estado de la
 * migración: corre igual desde el comando y desde la migración del modelo que se ejecuta en el
 * despliegue. Volver a correrla no duplica nada: reusa las etiquetas que ya existen y saltea las
 * asignaciones ya puestas. Lo que todavía no esté migrado se ignora en silencio.
 */
export async function importTags (
  client: TxOperations,
  perfex: PerfexReader,
  logger: Logger,
  options: TagImportOptions
): Promise<void> {
  const avisarAvance = options.onProgress ?? ((): void => {})
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

  // 1. Los documentos migrados, buscados por el id que traen del board.
  const tareas = await tareasPorPerfexId(client, plan)
  const proyectos = await proyectosPorPerfexId(client, plan)
  logger.log(`Tareas encontradas en este workspace: ${tareas.size}, proyectos: ${proyectos.size}`)
  if (tareas.size === 0 && proyectos.size === 0) return

  // 2. Un TagElement por nombre y por clase destino: el picker de Huly busca por targetClass
  //    exacto, así que la etiqueta de tareas y la de proyectos son dos documentos distintos.
  const usadasEnTareas = plan.elementos.filter((e) => e.tareas.some((id) => tareas.has(id)))
  const usadasEnProyectos = plan.elementos.filter((e) => e.proyectos.some((id) => proyectos.has(id)))
  const elementosDeTarea = await asegurarElementos(client, usadasEnTareas, tracker.class.Issue, logger)
  const elementosDeProyecto = await asegurarElementos(client, usadasEnProyectos, tracker.class.Project, logger)
  avisarAvance()

  // 3. Las asignaciones, cada una en el espacio del documento que etiqueta.
  const pendientes: Array<{
    space: Ref<Space>
    attachedTo: Ref<Doc>
    attachedToClass: Ref<Class<Doc>>
    data: AttachedData<TagReference>
  }> = []

  for (const elemento of plan.elementos) {
    const clave = normalizarNombre(elemento.nombre)

    const tagTarea = elementosDeTarea.get(clave)
    if (tagTarea !== undefined) {
      for (const idPerfex of elemento.tareas) {
        const tarea = tareas.get(idPerfex)
        if (tarea === undefined) continue
        pendientes.push({
          space: tarea.space,
          attachedTo: tarea.id,
          attachedToClass: tracker.class.Issue,
          data: { title: elemento.nombre, color: elemento.color, tag: tagTarea }
        })
      }
    }

    const tagProyecto = elementosDeProyecto.get(clave)
    if (tagProyecto !== undefined) {
      for (const idPerfex of elemento.proyectos) {
        const projectId = proyectos.get(idPerfex)
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

  // 4. Las que ya estén puestas se saltean, para que una segunda corrida no duplique nada.
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
    avisarAvance()
  }
  logger.log(`Etiquetas puestas: ${escritas}`)

  avisarAvance()
}

/**
 * Crea los TagElement que falten para estas etiquetas y devuelve el de cada una.
 *
 * Las que ya existen en el workspace se reusan, comparando por nombre normalizado: es lo que hace
 * que la migración se pueda repetir en cada despliegue sin llenar el selector de duplicados.
 *
 * @returns el `TagElement` de cada etiqueta, por nombre normalizado.
 */
async function asegurarElementos (
  client: TxOperations,
  elementos: EtiquetaPlanificada[],
  targetClass: Ref<Class<Doc>>,
  logger: Logger
): Promise<Map<string, Ref<TagElement>>> {
  const porNombre = new Map<string, Ref<TagElement>>()
  if (elementos.length === 0) return porNombre

  const existentes = await client.findAll(tags.class.TagElement, { targetClass })
  for (const existente of existentes) {
    porNombre.set(normalizarNombre(existente.title), existente._id)
  }

  let creados = 0
  for (const elemento of elementos) {
    const clave = normalizarNombre(elemento.nombre)
    if (porNombre.has(clave)) continue

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
    porNombre.set(clave, tagId)
    creados++
  }
  logger.log(`Etiquetas creadas para ${targetClass}: ${creados} de ${elementos.length}`)
  return porNombre
}

/** Tareas migradas de este workspace, con su espacio, por id de tarea de Perfex. */
async function tareasPorPerfexId (
  client: TxOperations,
  plan: PlanDeEtiquetas
): Promise<Map<number, { id: Ref<Issue>, space: Ref<Project> }>> {
  const ids = [...new Set(plan.elementos.flatMap((e) => e.tareas))]
  const encontradas = new Map<number, { id: Ref<Issue>, space: Ref<Project> }>()

  for (let i = 0; i < ids.length; i += QUERY_BATCH) {
    const issues = await client.findAll(
      tracker.class.Issue,
      { perfexId: { $in: ids.slice(i, i + QUERY_BATCH) } },
      { projection: { _id: 1, space: 1, perfexId: 1 } }
    )
    for (const issue of issues) {
      if (issue.perfexId === undefined) continue
      encontradas.set(issue.perfexId, { id: issue._id, space: issue.space })
    }
  }
  return encontradas
}

/** Proyectos migrados de este workspace, por id de proyecto de Perfex. */
async function proyectosPorPerfexId (client: TxOperations, plan: PlanDeEtiquetas): Promise<Map<number, Ref<Project>>> {
  const ids = [...new Set(plan.elementos.flatMap((e) => e.proyectos))]
  const encontrados = new Map<number, Ref<Project>>()

  for (let i = 0; i < ids.length; i += QUERY_BATCH) {
    const proyectos = await client.findAll(
      tracker.class.Project,
      { perfexId: { $in: ids.slice(i, i + QUERY_BATCH) } },
      { projection: { _id: 1, perfexId: 1 } }
    )
    for (const proyecto of proyectos) {
      if (proyecto.perfexId === undefined) continue
      encontrados.set(proyecto.perfexId, proyecto._id)
    }
  }
  return encontrados
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
