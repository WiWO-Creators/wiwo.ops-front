//
// CLI de migración de clientes de Perfex CRM a Huly.
//
import core, {
  concatLink,
  SocialIdType,
  systemAccountUuid,
  TxOperations,
  type AccountUuid,
  type PersonId,
  type Ref,
  type WorkspaceDataId,
  type WorkspaceUuid
} from '@hcengineering/core'
import { type Person } from '@hcengineering/contact'
import { createRestClient } from '@hcengineering/api-client'
import { decodeToken } from '@hcengineering/server-token'
import { setMetadata } from '@hcengineering/platform'
import serverClientPlugin, {
  createClient,
  getAccountClient,
  getTransactorEndpoint
} from '@hcengineering/server-client'
import { FrontFileUploader, type FileUploader } from '@hcengineering/importer'
import { program } from 'commander'

import { ENVIRONMENTS, getEnvironment } from './environments'
import { openProjects } from './abrir'
import { closeProjects } from './cerrar'
import { createPermanentInvite } from './invitacion'
import { cleanWorkspace } from './limpiar'
import { notifyResult } from './aviso'
import { ALL_STAGES, importClients, type Logger, type Stage } from './import'
import { moveClient } from './move'
import { getPerfexConfig, PerfexReader } from './perfex'

function parseStages (value: string | undefined): Stage[] {
  if (value === undefined || value.trim() === '') return ALL_STAGES
  const stages = value.split(',').map((s) => s.trim()) as Stage[]
  const invalid = stages.filter((s) => !ALL_STAGES.includes(s))
  if (invalid.length > 0) {
    throw new Error(`Partes desconocidas: ${invalid.join(', ')}. Válidas: ${ALL_STAGES.join(', ')}`)
  }
  return stages
}

/**
 * Resuelve desde cuándo migrar tareas, a partir de una fecha o de una cantidad de meses.
 *
 * @throws Error si la fecha no se entiende, para no migrar de más por un tipeo.
 */
export function parseSince (desde: string | undefined, ultimosMeses: string | undefined): number | undefined {
  if (desde !== undefined && desde.trim() !== '') {
    const date = new Date(`${desde.trim()}T00:00:00`)
    if (isNaN(date.getTime())) {
      throw new Error(`Fecha inválida: "${desde}". Se espera AAAA-MM-DD, por ejemplo 2026-08-01`)
    }
    return date.getTime()
  }

  if (ultimosMeses !== undefined && ultimosMeses.trim() !== '') {
    const months = Number(ultimosMeses)
    if (!Number.isInteger(months) || months <= 0) {
      throw new Error(`Cantidad de meses inválida: "${ultimosMeses}". Se espera un entero positivo`)
    }
    const date = new Date()
    date.setMonth(date.getMonth() - months)
    return date.getTime()
  }

  return undefined
}

/** Se guardan las líneas del registro para poder mandarlas en el aviso de fin. */
const summary: string[] = []

const consoleLogger: Logger = {
  log: (msg: string) => {
    console.log(msg)
    // Las marcas de avance no aportan nada en el aviso final.
    if (!msg.startsWith('  ...')) summary.push(msg)
  },
  error: (msg: string) => {
    console.error(msg)
    summary.push(msg)
  }
}

export function perfexClientsTool (): void {
  program.version('0.1.0')

  program
    .command('import')
    .description('migra los clientes de Perfex CRM al workspace indicado')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace destino')
    .option('-u, --user <user>', 'usuario de Huly (email); no sirve si el ingreso es con Google')
    .option('-p, --password <password>', 'contraseña de Huly')
    .option('-t, --token <token>', 'token del workspace, alternativa al usuario (o variable HULY_TOKEN)')
    .requiredOption('-e, --env <ambiente>', `ambiente a migrar (${ENVIRONMENTS.map((e) => e.id).join(', ')})`)
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option(
      '--transactor <url>',
      'url directa del transactor, para saltear el proxy (o variable TRANSACTOR_URL)'
    )
    .option('--state <file>', 'archivo de estado para poder repetir la corrida (por defecto, uno por ambiente)')
    .option('--incluir-inactivos', 'migra también los clientes dados de baja en Perfex', false)
    .option('-s, --stages <stages>', `partes a correr, separadas por coma (${ALL_STAGES.join(', ')})`)
    .option('--desde <fecha>', 'sólo tareas creadas desde esta fecha, en formato AAAA-MM-DD')
    .option('--ultimos-meses <n>', 'sólo tareas de los últimos n meses')
    .option('--hasta <fecha>', 'sólo tareas creadas antes de esta fecha, para migrar por tandas')
    .option('--solo-abiertas', 'deja fuera las tareas ya completadas en Perfex', false)
    .option('--dry-run', 'no escribe nada en Huly: sólo informa qué haría', false)
    .option('--avisar-a <url>', 'url a la que avisar cuando termine (o variable AVISAR_URL)')
    .action(async (cmd) => {
      const environment = getEnvironment(cmd.env)
      const statePath = cmd.state ?? `./perfex-clients-state-${environment.id}.json`
      const options = {
        environment,
        statePath,
        stages: parseStages(cmd.stages),
        dryRun: cmd.dryRun === true,
        includeInactive: cmd.incluirInactivos === true,
        tasksSince: parseSince(cmd.desde, cmd.ultimosMeses),
        tasksUntil: parseSince(cmd.hasta, undefined),
        onlyOpenTasks: cmd.soloAbiertas === true
      }

      const avisarA = cmd.avisarA ?? process.env.AVISAR_URL
      // Todo va dentro del try, incluida la conexión a Perfex: una corrida que se deja en segundo
      // plano tiene que avisar también cuando falla antes de empezar.
      try {
        const perfex = await PerfexReader.connect(getPerfexConfig())
        try {
          if (options.dryRun) {
            // La simulación no necesita conexión a Huly: sólo lee Perfex e informa.
            await importClients(undefined as unknown as TxOperations, perfex, consoleLogger, options)
            return
          }

          const frontUrl = cmd.front ?? process.env.FRONT_URL
          if (frontUrl === undefined || frontUrl === '') {
            throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
          }
          const token = cmd.token ?? process.env.HULY_TOKEN
          const transactor = cmd.transactor ?? process.env.TRANSACTOR_URL
          await withHulyClient(
            { frontUrl, token, transactor, user: cmd.user, password: cmd.password, workspaceUrl: cmd.workspace },
            async (client, uploader, ensurePerson) => {
              await importClients(client, perfex, consoleLogger, options, uploader, ensurePerson)
            }
          )
        } finally {
          await perfex.close()
        }

        console.log(`RESULTADO: ok — ambiente ${environment.label}`)
        await notifyResult(avisarA, { environment: environment.label, ok: true, summary }, consoleLogger)
      } catch (err: any) {
        console.error(`RESULTADO: error — ambiente ${environment.label}: ${err.message}`)
        await notifyResult(
          avisarA,
          { environment: environment.label, ok: false, summary, error: err.message },
          consoleLogger
        )
        process.exitCode = 1
      }
    })

  program
    .command('abrir')
    .description('suma a todo el equipo como miembro de los proyectos, para que vean las tareas')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace')
    .requiredOption('-t, --token <token>', 'token del workspace (o variable HULY_TOKEN)')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('--transactor <url>', 'url directa del transactor (o variable TRANSACTOR_URL)')
    .option('--dry-run', 'no escribe nada: sólo informa qué cambiaría', false)
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      const token = cmd.token ?? process.env.HULY_TOKEN
      const transactor = cmd.transactor ?? process.env.TRANSACTOR_URL
      await withTokenClient(token, transactor, async (client) => {
        await openProjects(client, consoleLogger, { dryRun: cmd.dryRun === true })
      })
    })

  program
    .command('cerrar')
    .description('deja cada proyecto visible sólo para quienes tienen tareas ahí')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace')
    .requiredOption('-t, --token <token>', 'token del workspace (o variable HULY_TOKEN)')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('--transactor <url>', 'url directa del transactor (o variable TRANSACTOR_URL)')
    .option('--dry-run', 'no escribe nada: sólo informa a quién sacaría de cada proyecto', false)
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      const token = cmd.token ?? process.env.HULY_TOKEN
      const transactor = cmd.transactor ?? process.env.TRANSACTOR_URL
      await withTokenClient(token, transactor, async (client) => {
        await closeProjects(client, consoleLogger, { dryRun: cmd.dryRun === true })
      })
    })

  program
    .command('limpiar')
    .description('borra del workspace todo lo que trajo la migración, para poder importar de cero')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace')
    .requiredOption('-t, --token <token>', 'token del workspace (o variable HULY_TOKEN)')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('--transactor <url>', 'url directa del transactor (o variable TRANSACTOR_URL)')
    .option('--si-borrar-todo', 'confirma el borrado; sin esto sólo informa', false)
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      // El borrado no se puede deshacer, así que hay que pedirlo expresamente.
      const dryRun = cmd.siBorrarTodo !== true
      if (dryRun) {
        console.log('Modo informe: no se borra nada. Agregá --si-borrar-todo para hacerlo de verdad.')
      }

      const token = cmd.token ?? process.env.HULY_TOKEN
      const transactor = cmd.transactor ?? process.env.TRANSACTOR_URL
      await withTokenClient(token, transactor, async (client) => {
        await cleanWorkspace(client, consoleLogger, { dryRun })
      })
    })

  program
    .command('invitacion')
    .description('crea la invitación permanente de un workspace, para la pantalla de ingreso')
    .requiredOption('-t, --token <token>', 'token del workspace (o variable HULY_TOKEN)')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      const token = cmd.token ?? process.env.HULY_TOKEN
      if (token === undefined || token === '') {
        throw new Error('Falta el token: usá --token o la variable HULY_TOKEN')
      }
      await createPermanentInvite(token, consoleLogger)
    })

  program
    .command('mover')
    .description('mueve un cliente de un workspace a otro, con sus contactos')
    .requiredOption('-c, --cliente <nombre>', 'nombre del cliente, tal como figura en el origen')
    .requiredOption('--desde-token <token>', 'token del workspace de origen')
    .requiredOption('--hacia-token <token>', 'token del workspace destino')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('--transactor <url>', 'url directa del transactor (o variable TRANSACTOR_URL)')
    .option('--solo-copiar', 'copia al destino sin borrar del origen', false)
    .option('--dry-run', 'no escribe nada: sólo informa qué movería', false)
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      const transactor = cmd.transactor ?? process.env.TRANSACTOR_URL
      await withTokenClient(cmd.desdeToken, transactor, async (source) => {
        await withTokenClient(cmd.haciaToken, transactor, async (target) => {
          await moveClient(source, target, consoleLogger, {
            clientName: cmd.cliente,
            dryRun: cmd.dryRun === true,
            keepSource: cmd.soloCopiar === true
          })
        })
      })
    })

  program.parse(process.argv)
}

interface Credentials {
  frontUrl: string
  workspaceUrl: string
  /** Token del workspace. Es la unica via cuando el ingreso a Huly es con Google. */
  token?: string
  /**
   * Url directa del transactor, por ejemplo `ws://transactor:3333` corriendo dentro de la red de
   * Docker. Sirve para saltear el proxy cuando éste no deja pasar las peticiones que no son
   * WebSocket, que es de donde salen los errores 400 en el alta de personas.
   */
  transactor?: string
  user?: string
  password?: string
}

/**
 * Abre una sesión contra el workspace de Huly y entrega el cliente ya autenticado.
 *
 * Acepta dos formas de identificarse: un token del workspace, o usuario y contraseña. Si la
 * instancia entra con Google, la única que sirve es el token, porque no hay contraseña propia.
 */
async function withHulyClient (
  credentials: Credentials,
  f: (
    client: TxOperations,
    uploader: FileUploader,
    ensurePerson: (email: string, firstName: string, lastName: string) => Promise<Ref<Person>>
  ) => Promise<void>
): Promise<void> {
  await setupAccounts(credentials.frontUrl)

  const session =
    credentials.token !== undefined && credentials.token !== ''
      ? await resolveByToken(credentials.token, credentials.transactor)
      : await resolveByPassword(credentials)
  const { token, author, workspace, workspaceDataId } = session
  const endpoint = credentials.transactor ?? session.endpoint

  const uploader = new FrontFileUploader(credentials.frontUrl, workspace, workspaceDataId ?? workspace, token)
  // ensurePerson vive en la API REST del transactor: crea la persona junto con su identidad de
  // correo, así cuando esa persona entre con el mismo correo queda vinculada a este contacto.
  const restClient = createRestClient(endpoint, workspace, token)
  const ensurePerson = async (email: string, firstName: string, lastName: string): Promise<Ref<Person>> => {
    const { localPerson } = await restClient.ensurePerson(SocialIdType.EMAIL, email, firstName, lastName)
    return localPerson as Ref<Person>
  }

  const connection = await createClient(endpoint, token)
  try {
    await f(new TxOperations(connection, author), uploader, ensurePerson)
  } finally {
    await connection.close()
  }
}

/** Apunta el cliente al servicio de cuentas que declara el front. */
async function setupAccounts (frontUrl: string): Promise<void> {
  const config = await (await fetch(concatLink(frontUrl, '/config.json'))).json()
  setMetadata(serverClientPlugin.metadata.Endpoint, config.ACCOUNTS_URL)
}

/** Abre una sesión con un token de workspace y la cierra al terminar. */
async function withTokenClient (
  token: string,
  transactor: string | undefined,
  f: (client: TxOperations) => Promise<void>
): Promise<void> {
  const { endpoint, author } = await resolveByToken(token, transactor)
  const connection = await createClient(endpoint, token)
  try {
    await f(new TxOperations(connection, author))
  } finally {
    await connection.close()
  }
}

interface Session {
  endpoint: string
  token: string
  author: PersonId
  workspace: WorkspaceUuid
  workspaceDataId?: WorkspaceDataId
}

/** Conexión con un token ya emitido (`run-tool.sh generate-token <email> <workspace>`). */
async function resolveByToken (token: string, transactor?: string): Promise<Session> {
  // Con el transactor dado a mano no hace falta preguntarle al servicio de cuentas.
  const endpoint = transactor ?? (await getTransactorEndpoint(token, 'external'))
  // El token lleva adentro el workspace y la cuenta: no hace falta pedirlos por separado.
  // Se decodifica sin verificar la firma, que es cosa del servidor.
  const { workspace, account } = decodeToken(token, false)

  return { endpoint, token, workspace, author: await resolveAuthor(token, account) }
}

/**
 * Averigua a nombre de quién se van a crear los documentos.
 *
 * El servidor exige que cada cambio venga firmado por una identidad de la misma cuenta que emitió
 * el token; si no coinciden, responde `AccountMismatch`. La cuenta de sistema es la excepción:
 * puede firmar como sistema. Por eso con un token de usuario hay que usar su identidad real.
 */
async function resolveAuthor (token: string, account: AccountUuid): Promise<PersonId> {
  if (account === systemAccountUuid) return core.account.System

  const info = await getAccountClient(token).getLoginInfoByToken()
  const socialId = (info as { socialId?: PersonId } | null)?.socialId
  if (socialId === undefined) {
    throw new Error(
      'El token no trae una identidad con la que firmar los documentos. Generá el token para tu ' +
        'propio correo, o usá el de la cuenta de sistema.'
    )
  }
  return socialId
}

/** Conexión con usuario y contraseña, para instancias que no usan proveedores externos. */
async function resolveByPassword (credentials: Credentials): Promise<Session> {
  const { user, password, workspaceUrl } = credentials
  if (user === undefined || password === undefined) {
    throw new Error('Falta identificarse: pasá --token, o bien --user y --password')
  }

  const login = await getAccountClient().login(user, password)
  if (login.token === undefined || login.account === undefined || login.socialId === undefined) {
    throw new Error(`No se pudo iniciar sesión con el usuario ${user}`)
  }

  const accountClient = getAccountClient(login.token)
  const workspaces = (await accountClient.getUserWorkspaces()).filter((ws) => ws.url === workspaceUrl)
  if (workspaces.length === 0) {
    throw new Error(`El usuario ${user} no tiene acceso al workspace ${workspaceUrl}`)
  }
  const selectedWs = await accountClient.selectWorkspace(workspaces[0].url)

  return {
    endpoint: selectedWs.endpoint,
    token: selectedWs.token,
    author: login.socialId,
    workspace: selectedWs.workspace,
    workspaceDataId: selectedWs.workspaceDataId
  }
}
