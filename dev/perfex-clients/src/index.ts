//
// CLI de migración de clientes de Perfex CRM a Huly.
//
import core, { concatLink, TxOperations, type PersonId } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverClientPlugin, {
  createClient,
  getAccountClient,
  getTransactorEndpoint
} from '@hcengineering/server-client'
import { program } from 'commander'

import { ENVIRONMENTS, getEnvironment } from './environments'
import { importClients, type Logger } from './import'
import { moveClient } from './move'
import { getPerfexConfig, PerfexReader } from './perfex'

const consoleLogger: Logger = {
  log: (msg: string) => {
    console.log(msg)
  },
  error: (msg: string) => {
    console.error(msg)
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
    .option('--state <file>', 'archivo de estado para poder repetir la corrida (por defecto, uno por ambiente)')
    .option('--incluir-inactivos', 'migra también los clientes dados de baja en Perfex', false)
    .option('--dry-run', 'no escribe nada en Huly: sólo informa qué haría', false)
    .action(async (cmd) => {
      const environment = getEnvironment(cmd.env)
      const statePath = cmd.state ?? `./perfex-clients-state-${environment.id}.json`
      const options = {
        environment,
        statePath,
        dryRun: cmd.dryRun === true,
        includeInactive: cmd.incluirInactivos === true
      }

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
        await withHulyClient(
          { frontUrl, token, user: cmd.user, password: cmd.password, workspaceUrl: cmd.workspace },
          async (client) => {
            await importClients(client, perfex, consoleLogger, options)
          }
        )
      } finally {
        await perfex.close()
      }
    })

  program
    .command('mover')
    .description('mueve un cliente de un workspace a otro, con sus contactos')
    .requiredOption('-c, --cliente <nombre>', 'nombre del cliente, tal como figura en el origen')
    .requiredOption('--desde-token <token>', 'token del workspace de origen')
    .requiredOption('--hacia-token <token>', 'token del workspace destino')
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('--solo-copiar', 'copia al destino sin borrar del origen', false)
    .option('--dry-run', 'no escribe nada: sólo informa qué movería', false)
    .action(async (cmd) => {
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        throw new Error('Falta la url del front: usá --front o la variable FRONT_URL')
      }
      await setupAccounts(frontUrl)

      await withTokenClient(cmd.desdeToken, async (source) => {
        await withTokenClient(cmd.haciaToken, async (target) => {
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
  user?: string
  password?: string
}

/**
 * Abre una sesión contra el workspace de Huly y entrega el cliente ya autenticado.
 *
 * Acepta dos formas de identificarse: un token del workspace, o usuario y contraseña. Si la
 * instancia entra con Google, la única que sirve es el token, porque no hay contraseña propia.
 */
async function withHulyClient (credentials: Credentials, f: (client: TxOperations) => Promise<void>): Promise<void> {
  await setupAccounts(credentials.frontUrl)

  const { endpoint, token, author } =
    credentials.token !== undefined && credentials.token !== ''
      ? await resolveByToken(credentials.token)
      : await resolveByPassword(credentials)

  const connection = await createClient(endpoint, token)
  try {
    await f(new TxOperations(connection, author))
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
async function withTokenClient (token: string, f: (client: TxOperations) => Promise<void>): Promise<void> {
  const { endpoint, author } = await resolveByToken(token)
  const connection = await createClient(endpoint, token)
  try {
    await f(new TxOperations(connection, author))
  } finally {
    await connection.close()
  }
}

/** Conexión con un token ya emitido (`run-tool.sh generate-token <email> <workspace>`). */
async function resolveByToken (token: string): Promise<{ endpoint: string, token: string, author: PersonId }> {
  const endpoint = await getTransactorEndpoint(token, 'external')
  // Con un token de servicio no hay identidad social propia: los documentos quedan a nombre
  // del sistema, que es lo esperable para una carga masiva.
  return { endpoint, token, author: core.account.System }
}

/** Conexión con usuario y contraseña, para instancias que no usan proveedores externos. */
async function resolveByPassword (
  credentials: Credentials
): Promise<{ endpoint: string, token: string, author: PersonId }> {
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

  return { endpoint: selectedWs.endpoint, token: selectedWs.token, author: login.socialId }
}
