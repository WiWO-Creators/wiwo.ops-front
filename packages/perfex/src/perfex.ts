//
// Lectura de los clientes de Perfex CRM.
//
// El usuario de base de datos debe ser de sólo lectura: este módulo nunca escribe en Perfex.
//
import { createConnection, type Connection, type RowDataPacket } from 'mysql2/promise'

/** Parámetros de conexión a la base de Perfex, tomados de variables de entorno. */
export interface PerfexConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  /** Prefijo de las tablas de Perfex. Por defecto `tbl`. */
  prefix: string
}

/** Persona de contacto de un cliente. */
export interface PerfexContact {
  id: number
  clientId: number
  firstName: string
  lastName: string
  email: string
  phone: string
  /** Perfex marca un contacto principal por cliente. */
  isPrimary: boolean
}

export interface PerfexClient {
  id: number
  company: string
  phone: string
  website: string
  city: string
  address: string
  active: boolean
  /** Grupos de cliente de Perfex, que son los que definen el ambiente destino. */
  groups: string[]
  /** Carpeta de Drive del cliente, del campo personalizado de Perfex. */
  driveLink?: string
  contacts: PerfexContact[]
}

export interface PerfexStaff {
  staffid: number
  email: string
  firstname: string
  lastname: string
  active: number
}

export interface PerfexProject {
  id: number
  name: string
  description: string | null
  status: number
  clientid: number
  start_date: string | null
  deadline: string | null
}

export interface PerfexTask {
  id: number
  name: string
  description: string | null
  priority: number
  status: number
  dateadded: Date
  startdate: string | null
  duedate: string | null
  rel_id: number | null
  rel_type: string | null
  /** Hito al que pertenece la tarea. 0 cuando no tiene ninguno. */
  milestone: number
  /** Área(s) de la compañía, del campo personalizado multiselect de Perfex. */
  companyArea: string[]
  /** Link de Drive, del campo personalizado de Perfex. */
  driveLink?: string
  /** staffid de los asignados, en el orden en que Perfex los devuelve. */
  assignees: number[]
}

/** Hito de un proyecto de Perfex: lo que en el board es una columna del tablero de Hitos. */
export interface PerfexMilestone {
  id: number
  name: string
  description: string | null
  start_date: string | null
  due_date: string
  project_id: number
  /** Color en hexadecimal elegido a mano, o vacío si el hito nunca se pintó. */
  color: string | null
  milestone_order: number
}

/** Etiqueta del board: sólo un nombre, sin color ni categoría. */
export interface PerfexTag {
  id: number
  name: string
}

/** Asignación de una etiqueta a una tarea o a un proyecto del board. */
export interface PerfexTagAssignment {
  tag_id: number
  rel_id: number
  rel_type: string
}

export interface PerfexComment {
  id: number
  taskid: number
  content: string
  staffid: number | null
  dateadded: Date
}

/** Objetos del board que pueden tener archivos colgados y que se migran. */
export type PerfexFileOwner = 'task' | 'contract' | 'customer'

/**
 * Archivo adjunto del board.
 *
 * `tblfiles` guarda la ruta y los metadatos, nunca el contenido: el binario vive en el disco del
 * servidor, bajo `uploads/<carpeta>/<rel_id>/<file_name>`.
 */
export interface PerfexFile {
  id: number
  /** Id del objeto dueño: la tarea, el contrato o el cliente. */
  rel_id: number
  rel_type: PerfexFileOwner
  file_name: string
  /** MIME declarado por Perfex. Es `varchar(40)`, así que los de Office llegan cortados. */
  filetype: string | null
  /** Distinto de 0 si en el board el archivo colgaba de un comentario de la tarea. */
  task_comment_id: number
  dateadded: Date
}

/** Contrato del board, para saber a qué cliente pertenece cada PDF adjunto. */
export interface PerfexContract {
  id: number
  client: number
  subject: string | null
}

/** Campos personalizados de Perfex que se migran. */
const CUSTOM_FIELD_DRIVE = 'Link de Drive'
const CUSTOM_FIELD_AREA = 'Area de la compañía'

/**
 * Configuración de conexión al board, o `undefined` si el entorno no la trae.
 *
 * La usan las migraciones que corren en el despliegue: en un servidor sin credenciales de Perfex
 * la migración se saltea en vez de fallar.
 */
export function tryGetPerfexConfig (): PerfexConfig | undefined {
  try {
    return getPerfexConfig()
  } catch {
    return undefined
  }
}

/**
 * Lee la configuración de conexión desde el entorno.
 *
 * @throws Error si falta alguna variable obligatoria.
 */
export function getPerfexConfig (): PerfexConfig {
  const required = ['PERFEX_DB_HOST', 'PERFEX_DB_USER', 'PERFEX_DB_PASSWORD', 'PERFEX_DB_NAME']
  const missing = required.filter((name) => (process.env[name] ?? '') === '')
  if (missing.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missing.join(', ')}`)
  }
  return {
    host: process.env.PERFEX_DB_HOST as string,
    port: Number(process.env.PERFEX_DB_PORT ?? 3306),
    user: process.env.PERFEX_DB_USER as string,
    password: process.env.PERFEX_DB_PASSWORD as string,
    database: process.env.PERFEX_DB_NAME as string,
    prefix: process.env.PERFEX_DB_PREFIX ?? 'tbl'
  }
}

/**
 * Extrae la URL de un campo de tipo enlace de Perfex, que se guarda como HTML
 * (`<a href="https://...">texto</a>`) y no como URL pelada.
 */
export function extractUrl (value: string): string {
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(value)
  if (href !== null) return href[1].trim()
  return value.replace(/<[^>]*>/g, '').trim()
}

/** Lee los clientes de Perfex con sus contactos, grupos y carpeta de Drive. */
export class PerfexReader {
  private constructor (
    private readonly connection: Connection,
    private readonly prefix: string
  ) {}

  static async connect (config: PerfexConfig): Promise<PerfexReader> {
    const connection = await createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    })
    return new PerfexReader(connection, config.prefix)
  }

  async close (): Promise<void> {
    await this.connection.end()
  }

  private async query<T>(sql: string): Promise<T[]> {
    const [rows] = await this.connection.query<RowDataPacket[]>(sql.replaceAll('{p}', this.prefix))
    return rows as T[]
  }

  async getClients (): Promise<PerfexClient[]> {
    const rows = await this.query<{
      id: number
      company: string
      phonenumber: string | null
      website: string | null
      city: string | null
      address: string | null
      active: number
    }>(
      `SELECT userid AS id, company, phonenumber, website, city, address, active
       FROM {p}clients ORDER BY company`
    )

    const groups = await this.getGroups()
    const drive = await this.getDriveLinks()
    const contacts = await this.getContacts()

    return rows.map((row) => ({
      id: row.id,
      company: row.company.trim(),
      phone: (row.phonenumber ?? '').trim(),
      website: (row.website ?? '').trim(),
      city: (row.city ?? '').trim(),
      address: (row.address ?? '').trim(),
      active: row.active === 1,
      groups: groups.get(row.id) ?? [],
      driveLink: drive.get(row.id),
      contacts: contacts.get(row.id) ?? []
    }))
  }

  /**
   * Grupos por cliente. En Perfex la asignación vive en `{p}customer_groups` y el nombre del
   * grupo en `{p}customers_groups`: sí, los nombres de las dos tablas están cruzados.
   */
  private async getGroups (): Promise<Map<number, string[]>> {
    const rows = await this.query<{ customer_id: number, name: string }>(
      `SELECT cg.customer_id, g.name
       FROM {p}customer_groups cg
       JOIN {p}customers_groups g ON g.id = cg.groupid`
    )
    const result = new Map<number, string[]>()
    for (const row of rows) {
      const list = result.get(row.customer_id) ?? []
      const name = row.name.trim()
      if (!list.includes(name)) list.push(name)
      result.set(row.customer_id, list)
    }
    return result
  }

  private async getDriveLinks (): Promise<Map<number, string>> {
    const rows = await this.query<{ relid: number, value: string }>(
      `SELECT v.relid, v.value
       FROM {p}customfieldsvalues v
       JOIN {p}customfields f ON f.id = v.fieldid
       WHERE f.fieldto = 'customers' AND f.name = '${CUSTOM_FIELD_DRIVE}' AND v.value <> ''`
    )
    return new Map(rows.map((row) => [row.relid, extractUrl(row.value)]))
  }

  private async getContacts (): Promise<Map<number, PerfexContact[]>> {
    const rows = await this.query<{
      id: number
      userid: number
      firstname: string | null
      lastname: string | null
      email: string | null
      phonenumber: string | null
      is_primary: number
    }>(
      `SELECT id, userid, firstname, lastname, email, phonenumber, is_primary
       FROM {p}contacts ORDER BY is_primary DESC, id`
    )
    const result = new Map<number, PerfexContact[]>()
    for (const row of rows) {
      const list = result.get(row.userid) ?? []
      list.push({
        id: row.id,
        clientId: row.userid,
        firstName: (row.firstname ?? '').trim(),
        lastName: (row.lastname ?? '').trim(),
        email: (row.email ?? '').trim(),
        phone: (row.phonenumber ?? '').trim(),
        isPrimary: row.is_primary === 1
      })
      result.set(row.userid, list)
    }
    return result
  }

  async getStaff (): Promise<PerfexStaff[]> {
    return await this.query<PerfexStaff>(
      'SELECT staffid, email, firstname, lastname, active FROM {p}staff ORDER BY staffid'
    )
  }

  async getProjects (): Promise<PerfexProject[]> {
    return await this.query<PerfexProject>(
      `SELECT id, name, description, status, clientid, start_date, deadline
       FROM {p}projects ORDER BY id`
    )
  }

  /** Tareas con sus asignados y campos personalizados ya resueltos. */
  async getTasks (): Promise<PerfexTask[]> {
    const tasks = await this.query<PerfexTask>(
      `SELECT id, name, description, priority, status, dateadded, startdate, duedate,
              rel_id, rel_type, milestone
       FROM {p}tasks ORDER BY id`
    )

    const assigned = await this.query<{ taskid: number, staffid: number }>(
      'SELECT taskid, staffid FROM {p}task_assigned ORDER BY id'
    )
    const assigneesByTask = new Map<number, number[]>()
    for (const row of assigned) {
      const list = assigneesByTask.get(row.taskid) ?? []
      list.push(row.staffid)
      assigneesByTask.set(row.taskid, list)
    }

    const customValues = await this.query<{ relid: number, name: string, value: string }>(
      `SELECT v.relid, f.name, v.value
       FROM {p}customfieldsvalues v
       JOIN {p}customfields f ON f.id = v.fieldid
       WHERE f.fieldto = 'tasks' AND v.value <> ''`
    )
    const areaByTask = new Map<number, string[]>()
    const driveByTask = new Map<number, string>()
    for (const row of customValues) {
      if (row.name === CUSTOM_FIELD_AREA) {
        areaByTask.set(
          row.relid,
          row.value
            .split(',')
            .map((v) => v.trim())
            .filter((v) => v !== '')
        )
      } else if (row.name === CUSTOM_FIELD_DRIVE) {
        driveByTask.set(row.relid, extractUrl(row.value))
      }
    }

    for (const task of tasks) {
      task.assignees = assigneesByTask.get(task.id) ?? []
      task.companyArea = areaByTask.get(task.id) ?? []
      task.driveLink = driveByTask.get(task.id)
    }
    return tasks
  }

  async getMilestones (): Promise<PerfexMilestone[]> {
    return await this.query<PerfexMilestone>(
      `SELECT id, name, description, start_date, due_date, project_id, color, milestone_order
       FROM {p}milestones ORDER BY project_id, milestone_order, id`
    )
  }

  async getTags (): Promise<PerfexTag[]> {
    return await this.query<PerfexTag>('SELECT id, name FROM {p}tags ORDER BY id')
  }

  /** Asignaciones de etiquetas a tareas y proyectos; el resto de los `rel_type` no se migra. */
  async getTagAssignments (): Promise<PerfexTagAssignment[]> {
    return await this.query<PerfexTagAssignment>(
      `SELECT tag_id, rel_id, rel_type
       FROM {p}taggables
       WHERE rel_type IN ('task', 'project') ORDER BY tag_id, rel_id`
    )
  }

  async getComments (): Promise<PerfexComment[]> {
    return await this.query<PerfexComment>(
      'SELECT id, taskid, content, staffid, dateadded FROM {p}task_comments ORDER BY id'
    )
  }

  /**
   * Archivos adjuntos de tareas, contratos y clientes.
   *
   * No se leen `external` ni `external_link`: en el board no hay ninguna fila que los use, así que
   * todos los adjuntos son archivos en disco y no enlaces a Drive o Dropbox.
   */
  async getFiles (): Promise<PerfexFile[]> {
    return await this.query<PerfexFile>(
      `SELECT id, rel_id, rel_type, file_name, filetype, task_comment_id, dateadded
       FROM {p}files
       WHERE rel_type IN ('task', 'contract', 'customer') ORDER BY id`
    )
  }

  /** Contratos vigentes del board, con el cliente al que pertenecen. */
  async getContracts (): Promise<PerfexContract[]> {
    return await this.query<PerfexContract>('SELECT id, client, subject FROM {p}contracts WHERE trash = 0 ORDER BY id')
  }
}
