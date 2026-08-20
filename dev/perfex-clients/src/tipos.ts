//
// Limpieza de tipos de proyecto repetidos.
//
// Cada corrida vieja de la importación dejaba un tipo de proyecto nuevo con el mismo nombre
// ("Perfex"), y todos aparecen juntos en el selector al crear un espacio. Acá se borran los
// repetidos que no tengan ningún proyecto usándolos.
//
import { type Ref, type TxOperations } from '@hcengineering/core'
import task, { type ProjectType, type TaskType } from '@hcengineering/task'
import tracker from '@hcengineering/tracker'

import { type Logger } from './import'

export interface TipoConUso {
  id: Ref<ProjectType>
  name: string
  createdOn: number
  projects: number
}

export interface PlanDeLimpieza {
  /** Tipos repetidos y sin proyectos: se pueden borrar. */
  borrar: TipoConUso[]
  /** Tipos repetidos que sí tienen proyectos: los decide una persona. */
  enUso: TipoConUso[]
}

export interface CleanTypesOptions {
  /** Si es true no borra nada: sólo informa qué borraría. */
  dryRun: boolean
}

/**
 * Decide qué tipos repetidos se pueden borrar.
 *
 * Un tipo sólo entra en `borrar` si comparte nombre con otro y no lo usa ningún proyecto. De cada
 * nombre repetido se conserva siempre uno: el que más proyectos tenga y, a igualdad, el más viejo.
 *
 * @param tipos todos los tipos de proyecto del workspace, con su cantidad de proyectos.
 * @returns qué borrar y qué repetidos quedan en uso.
 */
export function planificarLimpieza (tipos: TipoConUso[]): PlanDeLimpieza {
  const porNombre = new Map<string, TipoConUso[]>()
  for (const tipo of tipos) {
    const grupo = porNombre.get(tipo.name) ?? []
    grupo.push(tipo)
    porNombre.set(tipo.name, grupo)
  }

  const borrar: TipoConUso[] = []
  const enUso: TipoConUso[] = []
  for (const grupo of porNombre.values()) {
    if (grupo.length < 2) continue

    const ordenados = [...grupo].sort((a, b) =>
      a.projects !== b.projects ? b.projects - a.projects : a.createdOn - b.createdOn
    )
    const [, ...resto] = ordenados
    for (const tipo of resto) {
      if (tipo.projects === 0) borrar.push(tipo)
      else enUso.push(tipo)
    }
  }
  return { borrar, enUso }
}

/** Lee del workspace todos los tipos de proyecto del tracker con su cantidad de proyectos. */
export async function leerTipos (client: TxOperations): Promise<TipoConUso[]> {
  const tipos = await client.findAll(task.class.ProjectType, { descriptor: tracker.descriptors.ProjectType })
  const projects = await client.findAll(tracker.class.Project, {}, { projection: { type: 1 } })

  const usos = new Map<Ref<ProjectType>, number>()
  for (const project of projects) {
    usos.set(project.type, (usos.get(project.type) ?? 0) + 1)
  }

  return tipos.map((t) => ({
    id: t._id,
    name: t.name,
    createdOn: t.createdOn ?? t.modifiedOn,
    projects: usos.get(t._id) ?? 0
  }))
}

/**
 * Borra los tipos de proyecto repetidos que no use ningún proyecto.
 *
 * Se lleva también los tipos de tarea que colgaban de cada uno, para no dejarlos huérfanos.
 *
 * @returns los tipos borrados (o los que se borrarían, en modo informe).
 */
export async function limpiarTiposRepetidos (
  client: TxOperations,
  logger: Logger,
  options: CleanTypesOptions
): Promise<TipoConUso[]> {
  const tipos = await leerTipos(client)
  logger.log(`Tipos de proyecto: ${tipos.length}`)
  for (const tipo of tipos) {
    logger.log(`  ${tipo.name} — ${tipo.projects} proyecto(s)`)
  }

  const { borrar, enUso } = planificarLimpieza(tipos)
  for (const tipo of enUso) {
    logger.log(`Repetido pero con proyectos, no se toca: ${tipo.name} (${tipo.projects} proyecto(s))`)
  }

  if (borrar.length === 0) {
    logger.log('No hay tipos repetidos y vacíos para borrar')
    return borrar
  }

  logger.log(`A borrar: ${borrar.length} tipo(s) repetido(s) y sin proyectos` + (options.dryRun ? ' (simulado)' : ''))
  if (options.dryRun) return borrar

  const docs = await client.findAll(task.class.ProjectType, { _id: { $in: borrar.map((t) => t.id) } })
  for (const doc of docs) {
    // Queda el mixin targetClass del tipo, invisible en la interfaz: borrarlo pide tocar el modelo
    // del workspace y no aporta nada al selector.
    const taskTypes = await client.findAll<TaskType>(task.class.TaskType, { parent: doc._id })
    for (const taskType of taskTypes) {
      await client.remove(taskType)
    }
    await client.remove(doc)
  }
  logger.log(`Tipos borrados: ${borrar.length}`)
  return borrar
}
