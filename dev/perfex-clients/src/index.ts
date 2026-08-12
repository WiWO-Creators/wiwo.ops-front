//
// CLI de migración de clientes de Perfex CRM a Huly.
//
import { concatLink, TxOperations } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverClientPlugin, { createClient, getAccountClient } from '@hcengineering/server-client'
import { program } from 'commander'

import { ENVIRONMENTS, getEnvironment } from './environments'
import { importClients, type Logger } from './import'
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
    .requiredOption('-u, --user <user>', 'usuario de Huly (email)')
    .requiredOption('-p, --password <password>', 'contraseña de Huly')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace destino')
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
        await withHulyClient(frontUrl, cmd.user, cmd.password, cmd.workspace, async (client) => {
          await importClients(client, perfex, consoleLogger, options)
        })
      } finally {
        await perfex.close()
      }
    })

  program.parse(process.argv)
}

/** Abre una sesión contra el workspace de Huly y entrega el cliente ya autenticado. */
async function withHulyClient (
  frontUrl: string,
  user: string,
  password: string,
  workspaceUrl: string,
  f: (client: TxOperations) => Promise<void>
): Promise<void> {
  const config = await (await fetch(concatLink(frontUrl, '/config.json'))).json()
  setMetadata(serverClientPlugin.metadata.Endpoint, config.ACCOUNTS_URL)

  const { account, token, socialId } = await getAccountClient().login(user, password)
  if (token === undefined || account === undefined || socialId === undefined) {
    throw new Error(`No se pudo iniciar sesión con el usuario ${user}`)
  }

  const accountClient = getAccountClient(token)
  const workspaces = (await accountClient.getUserWorkspaces()).filter((ws) => ws.url === workspaceUrl)
  if (workspaces.length === 0) {
    throw new Error(`El usuario ${user} no tiene acceso al workspace ${workspaceUrl}`)
  }
  const selectedWs = await accountClient.selectWorkspace(workspaces[0].url)

  const connection = await createClient(selectedWs.endpoint, selectedWs.token)
  try {
    await f(new TxOperations(connection, socialId))
  } finally {
    await connection.close()
  }
}
