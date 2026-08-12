//
// Lectura de la base de datos de Perfex CRM.
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

export interface PerfexStaff {
  staffid: number
  email: string
  firstname: string
  lastname: string
  active: number
}

export interface PerfexClient {
  userid: number
  company: string
  vat: string | null
  phonenumber: string | null
  website: string | null
  city: string | null
  address: string | null
  active: number
  /** Grupos de cliente de Perfex, que son los que definen el ambiente destino. */
  groups: string[]
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
  milestone: number | null
  /** Área(s) de la compañía, del campo personalizado multiselect de Perfex. */
  companyArea: string[]
  /** Link de Drive, del campo personalizado de Perfex. */
  driveLink?: string
  /** staffid de los asignados, en el orden en que Perfex los devuelve. */
  assignees: number[]
}

export interface PerfexComment {
  id: number
  taskid: number
  content: string
  staffid: number | null
  dateadded: Date
}

/** Nombres de los campos personalizados de Perfex que se migran a atributos de la tarea. */
export const CUSTOM_FIELD_AREA = 'Area de la compañía'
export const CUSTOM_FIELD_DRIVE = 'Link de Drive'

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
 * (`<a href="https://...">https://...</a>`) y no como URL pelada.
 */
export function extractUrl (value: string): string {
  const href = /href\s*=\s*["']([^"']+)["']/i.exec(value)
  if (href !== null) return href[1].trim()
  return value.replace(/<[^>]*>/g, '').trim()
}

/** Lector de Perfex. Abrir con {@link PerfexReader.connect} y cerrar con {@link PerfexReader.close}. */
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
      database: config.database,
      dateStrings: ['DATE'],
      // El dump puede traer descripciones largas; sin esto mysql2 corta los mediumtext.
      maxPreparedStatements: 100
    })
    return new PerfexReader(connection, config.prefix)
  }

  async close (): Promise<void> {
    await this.connection.end()
  }

  private async query<T> (sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await this.connection.query<RowDataPacket[]>(sql.replaceAll('{p}', this.prefix), params)
    return rows as T[]
  }

  async getStaff (): Promise<PerfexStaff[]> {
    return await this.query<PerfexStaff>(
      'SELECT staffid, email, firstname, lastname, active FROM {p}staff ORDER BY staffid'
    )
  }

  async getClients (): Promise<PerfexClient[]> {
    const clients = await this.query<PerfexClient>(
      `SELECT userid, company, vat, phonenumber, website, city, address, active
       FROM {p}clients ORDER BY userid`
    )

    // En Perfex la asignación vive en {p}customer_groups y el nombre del grupo en
    // {p}customers_groups (sí, los nombres de tabla están cruzados).
    const rows = await this.query<{ customer_id: number, name: string }>(
      `SELECT cg.customer_id, g.name
       FROM {p}customer_groups cg
       JOIN {p}customers_groups g ON g.id = cg.groupid`
    )
    const groupsByClient = new Map<number, string[]>()
    for (const row of rows) {
      const list = groupsByClient.get(row.customer_id) ?? []
      list.push(row.name.trim())
      groupsByClient.set(row.customer_id, list)
    }

    for (const client of clients) {
      client.groups = groupsByClient.get(client.userid) ?? []
    }
    return clients
  }

  async getProjects (): Promise<PerfexProject[]> {
    return await this.query<PerfexProject>(
      `SELECT id, name, description, status, clientid, start_date, deadline
       FROM {p}projects ORDER BY id`
    )
  }

  /**
   * Devuelve las tareas con sus asignados y campos personalizados ya resueltos.
   *
   * @param relType filtra por el tipo de entidad a la que cuelga la tarea (`project`, `customer`,
   * `lead`) o `null` para las tareas sueltas. Sin argumento devuelve todas.
   */
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

  async getComments (): Promise<PerfexComment[]> {
    return await this.query<PerfexComment>(
      'SELECT id, taskid, content, staffid, dateadded FROM {p}task_comments ORDER BY id'
    )
  }
}
