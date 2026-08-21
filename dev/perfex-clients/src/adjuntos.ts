//
// Alta en ops de los archivos que en el board colgaban de tareas, contratos y clientes.
//
// La base de Perfex guarda sólo la ruta y los metadatos (`tblfiles`); los binarios viven en el
// disco del servidor del board. Esta etapa lee esas filas y sube cada archivo desde la carpeta
// rescatada antes del corte, así que no sirve de nada sin ese rescate hecho.
//
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import attachment, { type Attachment } from '@hcengineering/attachment'
import contact, { type Organization } from '@hcengineering/contact'
import { type Class, type Doc, type Ref, type Space, type TxOperations } from '@hcengineering/core'
import { type FileUploader, type ImportAttachment, WorkspaceImporter } from '@hcengineering/importer'
import { type Logger, type PerfexFile, type PerfexReader, tareasPorPerfexId } from '@hcengineering/perfex'
import tracker from '@hcengineering/tracker'

/** Carpeta de `uploads/` donde el board guarda los archivos de cada tipo de objeto. */
const CARPETA_POR_TIPO = {
  task: 'tasks',
  contract: 'contracts',
  customer: 'clients'
} as const

/**
 * MIME por extensión, para los archivos cuyo `filetype` llega cortado.
 *
 * `tblfiles.filetype` es `varchar(40)`: los MIME largos de Office quedan partidos a media palabra y
 * un tipo inválido rompe la vista previa en ops.
 */
const TIPO_POR_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  mp4: 'video/mp4',
  mov: 'video/quicktime'
}

/** Largo de la columna `filetype`: un valor de este largo está muy probablemente truncado. */
const LARGO_FILETYPE = 40

/** Tipo genérico para lo que no se puede identificar; ops lo acepta y lo ofrece para descargar. */
const TIPO_GENERICO = 'application/octet-stream'

/** Cuántos documentos se consultan de una vez al buscar los adjuntos ya migrados. */
const QUERY_BATCH = 500

export interface AttachmentImportOptions {
  /** Carpeta local con el rescate del board: contiene `tasks/`, `contracts/` y `clients/`. */
  dir: string
  /** Clientes del ambiente que se está migrando, ya filtrados por la corrida. */
  clients: Array<{ id: number, company: string }>
  /** Si es true no escribe nada en ops: sólo informa qué archivos hay y cuáles faltan en disco. */
  dryRun: boolean
}

/**
 * Ruta del archivo dentro de la carpeta rescatada.
 *
 * Los adjuntos de comentario viven en la carpeta de la tarea, igual que los de la tarea misma:
 * `task_comment_id` es sólo un discriminador de la base, no cambia el lugar en el disco.
 *
 * @param dir carpeta que contiene `tasks/`, `contracts/` y `clients/`.
 */
export function rutaDeArchivo (dir: string, file: PerfexFile): string {
  return join(dir, CARPETA_POR_TIPO[file.rel_type], String(file.rel_id), file.file_name)
}

/**
 * MIME con el que se sube el archivo.
 *
 * Usa el que declara el board salvo que venga truncado; en ese caso lo deduce de la extensión y,
 * si tampoco la reconoce, cae en el tipo genérico.
 */
export function tipoDeArchivo (file: PerfexFile): string {
  const declarado = file.filetype?.trim() ?? ''
  if (declarado !== '' && declarado.length < LARGO_FILETYPE) return declarado

  const extension = file.file_name.split('.').pop()?.toLowerCase() ?? ''
  return TIPO_POR_EXTENSION[extension] ?? TIPO_GENERICO
}

/** Un archivo del board con el documento de ops al que se va a colgar. */
interface AdjuntoPlanificado {
  file: PerfexFile
  ruta: string
  parentId: Ref<Doc>
  parentClass: Ref<Class<Doc<Space>>>
  spaceId: Ref<Space>
}

/**
 * Sube a ops los adjuntos del board que correspondan a documentos ya migrados en este workspace.
 *
 * Los archivos de tareas van al panel de adjuntos de la tarea, incluidos los que en el board
 * colgaban de un comentario: los comentarios migrados no guardan el id de Perfex, así que no hay
 * forma de emparejarlos. Los de contratos y clientes van a la ficha de la empresa en Contactos.
 *
 * Volver a correrla no duplica nada: saltea los adjuntos que ya estén puestos, comparando por
 * documento y nombre de archivo. Lo que pertenezca a otro ambiente se ignora en silencio.
 *
 * @param client cliente de Huly ya autenticado contra el workspace destino.
 * @param uploader subidor de archivos contra el front de ops.
 * @throws si la carpeta del rescate no existe.
 */
export async function importAttachments (
  client: TxOperations,
  uploader: FileUploader,
  perfex: PerfexReader,
  logger: Logger,
  options: AttachmentImportOptions
): Promise<void> {
  if (!existsSync(options.dir)) {
    throw new Error(`No existe la carpeta de adjuntos: ${options.dir}`)
  }

  const files = await perfex.getFiles()
  const rutas = new Map(files.map((f) => [f.id, rutaDeArchivo(options.dir, f)]))
  const idsEnDisco = new Set(files.filter((f) => existsSync(rutas.get(f.id) as string)).map((f) => f.id))
  const enDisco = files.filter((f) => idsEnDisco.has(f.id))
  const faltantes = files.filter((f) => !idsEnDisco.has(f.id))

  const porTipo = (tipo: PerfexFile['rel_type']): number => files.filter((f) => f.rel_type === tipo).length
  logger.log(
    `Adjuntos en el board: ${files.length} (${porTipo('task')} de tareas, ${porTipo('contract')} de ` +
      `contratos, ${porTipo('customer')} de clientes); en disco: ${enDisco.length}` +
      (options.dryRun ? ' (simulado)' : '')
  )

  for (const file of faltantes) {
    logger.error(`Falta en el disco: ${rutas.get(file.id) as string}`)
  }

  if (options.dryRun) {
    logger.log('tipo,rel_id,archivo,en_disco')
    for (const file of files) {
      const nombre = file.file_name.replace(/"/g, '""')
      logger.log(`${file.rel_type},${file.rel_id},${nombre},${idsEnDisco.has(file.id) ? 'si' : 'no'}`)
    }
    return
  }

  const planificados = [
    ...(await planificarDeTareas(client, enDisco, options)),
    ...(await planificarDeEmpresas(client, perfex, enDisco, options))
  ]
  logger.log(`Adjuntos con documento en este workspace: ${planificados.length} de ${enDisco.length}`)
  if (planificados.length === 0) return

  const yaPuestos = await adjuntosExistentes(
    client,
    planificados.map((p) => p.parentId)
  )
  const pendientes = planificados.filter((p) => !yaPuestos.has(claveDeAdjunto(p.parentId, p.file.file_name)))
  logger.log(`Adjuntos a subir: ${pendientes.length} de ${planificados.length}`)
  if (pendientes.length === 0) return

  const attachments: ImportAttachment[] = pendientes.map((p) => ({
    title: p.file.file_name,
    blobProvider: async () => new Blob([readFileSync(p.ruta)], { type: tipoDeArchivo(p.file) }),
    parentId: p.parentId,
    parentClass: p.parentClass,
    spaceId: p.spaceId
  }))
  await new WorkspaceImporter(client, logger, uploader, { attachments }).performImport()

  // El importador se traga los fallos de subida de a uno, así que el total real se cuenta después.
  const despues = await adjuntosExistentes(
    client,
    pendientes.map((p) => p.parentId)
  )
  const escritos = pendientes.filter((p) => despues.has(claveDeAdjunto(p.parentId, p.file.file_name))).length
  logger.log(`Adjuntos subidos: ${escritos} de ${pendientes.length}`)
  if (escritos < pendientes.length) {
    logger.error(`Quedaron ${pendientes.length - escritos} adjuntos sin subir; repetir la etapa los reintenta`)
  }
}

/** Los adjuntos de tareas, colgados de la tarea migrada que les corresponde. */
async function planificarDeTareas (
  client: TxOperations,
  files: PerfexFile[],
  options: AttachmentImportOptions
): Promise<AdjuntoPlanificado[]> {
  const deTareas = files.filter((f) => f.rel_type === 'task')
  if (deTareas.length === 0) return []

  const tareas = await tareasPorPerfexId(
    client,
    deTareas.map((f) => f.rel_id)
  )

  const planificados: AdjuntoPlanificado[] = []
  for (const file of deTareas) {
    const tarea = tareas.get(file.rel_id)
    if (tarea === undefined) continue
    planificados.push({
      file,
      ruta: rutaDeArchivo(options.dir, file),
      parentId: tarea.id,
      parentClass: tracker.class.Issue,
      spaceId: tarea.space
    })
  }
  return planificados
}

/**
 * Los adjuntos de contratos y de clientes, colgados de la ficha de la empresa en Contactos.
 *
 * El contrato no viaja a ops (ver M11): su PDF queda en la empresa, que es donde alguien lo va a
 * buscar. La empresa se encuentra por nombre, que es lo único que comparten Perfex y ops.
 */
async function planificarDeEmpresas (
  client: TxOperations,
  perfex: PerfexReader,
  files: PerfexFile[],
  options: AttachmentImportOptions
): Promise<AdjuntoPlanificado[]> {
  const deEmpresas = files.filter((f) => f.rel_type === 'contract' || f.rel_type === 'customer')
  if (deEmpresas.length === 0) return []

  const contratos = deEmpresas.some((f) => f.rel_type === 'contract') ? await perfex.getContracts() : []
  const clientePorContrato = new Map(contratos.map((c) => [c.id, c.client]))
  const empresaPorCliente = new Map(options.clients.map((c) => [c.id, c.company]))

  /** Cliente de Perfex dueño del archivo, o `undefined` si el contrato no existe. */
  const clienteDeArchivo = (file: PerfexFile): number | undefined =>
    file.rel_type === 'customer' ? file.rel_id : clientePorContrato.get(file.rel_id)

  const nombres = [
    ...new Set(
      deEmpresas
        .map((f) => {
          const cliente = clienteDeArchivo(f)
          return cliente !== undefined ? empresaPorCliente.get(cliente) : undefined
        })
        .filter((nombre): nombre is string => nombre !== undefined)
    )
  ]
  if (nombres.length === 0) return []

  const organizaciones = await client.findAll(
    contact.class.Organization,
    { name: { $in: nombres } },
    { projection: { _id: 1, name: 1 } }
  )
  const organizacionPorNombre = new Map<string, Ref<Organization>>(organizaciones.map((o) => [o.name, o._id]))

  const planificados: AdjuntoPlanificado[] = []
  for (const file of deEmpresas) {
    const cliente = clienteDeArchivo(file)
    const nombre = cliente !== undefined ? empresaPorCliente.get(cliente) : undefined
    const organizacion = nombre !== undefined ? organizacionPorNombre.get(nombre) : undefined
    if (organizacion === undefined) continue
    planificados.push({
      file,
      ruta: rutaDeArchivo(options.dir, file),
      parentId: organizacion,
      parentClass: contact.class.Organization,
      spaceId: contact.space.Contacts
    })
  }
  return planificados
}

/** Clave con la que se reconoce un adjunto ya migrado: el documento y el nombre del archivo. */
function claveDeAdjunto (parentId: Ref<Doc>, nombre: string): string {
  return `${parentId}:${nombre}`
}

/** Adjuntos que ya cuelgan de estos documentos, para no volver a subirlos. */
async function adjuntosExistentes (client: TxOperations, parentIds: Array<Ref<Doc>>): Promise<Set<string>> {
  const ids = [...new Set(parentIds)]
  const puestos = new Set<string>()

  for (let i = 0; i < ids.length; i += QUERY_BATCH) {
    const existentes = await client.findAll<Attachment>(
      attachment.class.Attachment,
      { attachedTo: { $in: ids.slice(i, i + QUERY_BATCH) } },
      { projection: { _id: 1, attachedTo: 1, name: 1 } }
    )
    for (const existente of existentes) {
      puestos.add(claveDeAdjunto(existente.attachedTo, existente.name))
    }
  }
  return puestos
}
