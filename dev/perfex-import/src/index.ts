//
// CLI de migración de Perfex CRM a Huly.
//
import { concatLink, SocialIdType, TxOperations, type Ref } from '@hcengineering/core'
import { type Person } from '@hcengineering/contact'
import { createRestClient } from '@hcengineering/api-client'
import { FrontFileUploader, type FileUploader, type Logger } from '@hcengineering/importer'
import { setMetadata } from '@hcengineering/platform'
import serverClientPlugin, { createClient, getAccountClient, getTransactorEndpoint } from '@hcengineering/server-client'
import { program } from 'commander'

import { importPerfex, type Stage } from './import'
import { ENVIRONMENTS, getEnvironment } from './mapping'
import { getPerfexConfig, PerfexReader } from './perfex'

class ConsoleLogger implements Logger {
  log (msg: string, data?: any): void {
    console.log(msg, data ?? '')
  }

  error (msg: string, data?: any): void {
    console.error(msg, data ?? '')
  }
}

const ALL_STAGES: Stage[] = ['personas', 'clientes', 'proyectos']

function parseStages (value: string | undefined): Stage[] {
  if (value === undefined || value.trim() === '') return ALL_STAGES
  const stages = value.split(',').map((s) => s.trim()) as Stage[]
  const invalid = stages.filter((s) => !ALL_STAGES.includes(s))
  if (invalid.length > 0) {
    throw new Error(`Etapas desconocidas: ${invalid.join(', ')}. Válidas: ${ALL_STAGES.join(', ')}`)
  }
  return stages
}

export function perfexImportTool (): void {
  program.version('0.1.0')

  program
    .command('import')
    .description('migra clientes, proyectos y tareas de Perfex CRM al workspace indicado')
    .requiredOption('-u, --user <user>', 'usuario de Huly (email)')
    .requiredOption('-p, --password <password>', 'contraseña de Huly')
    .requiredOption('-w, --workspace <workspace>', 'url del workspace destino')
    .requiredOption('-e, --env <ambiente>', `ambiente a migrar (${ENVIRONMENTS.map((e) => e.id).join(', ')})`)
    .option('-f, --front <url>', 'url del front de Huly (o variable FRONT_URL)')
    .option('-s, --stages <stages>', `etapas a correr, separadas por coma (${ALL_STAGES.join(', ')})`)
    .option('--state <file>', 'archivo de estado para poder repetir la corrida (por defecto, uno por ambiente)')
    .option('--dry-run', 'no escribe nada en Huly: sólo informa qué haría', false)
    .action(async (cmd) => {
      const stages = parseStages(cmd.stages)
      const environment = getEnvironment(cmd.env)
      // Cada ambiente es un workspace distinto, así que lleva su propio archivo de estado.
      const statePath = cmd.state ?? `./perfex-import-state-${environment.id}.json`
      const logger = new ConsoleLogger()
      const frontUrl = cmd.front ?? process.env.FRONT_URL
      if (frontUrl === undefined || frontUrl === '') {
        console.error('Falta la url del front: usá --front o la variable FRONT_URL')
        process.exit(1)
      }

      const perfex = await PerfexReader.connect(getPerfexConfig())
      try {
        if (cmd.dryRun === true) {
          // La simulación no necesita conexión a Huly: sólo lee Perfex e informa.
          await importPerfex(
            undefined as unknown as TxOperations,
            undefined as unknown as FileUploader,
            perfex,
            logger,
            async () => undefined as unknown as Ref<Person>,
            { environment, stages, dryRun: true, statePath }
          )
          return
        }

        await withHulyClient(frontUrl, cmd.user, cmd.password, cmd.workspace, async (client, uploader, ensure) => {
          await importPerfex(client, uploader, perfex, logger, ensure, {
            environment,
            stages,
            dryRun: false,
            statePath
          })
        })
      } finally {
        await perfex.close()
      }
    })

  program.parse(process.argv)
}

/**
 * Abre una sesión contra el workspace de Huly y entrega el cliente, el subidor de archivos y la
 * función que crea personas a partir de un email.
 */
async function withHulyClient (
  frontUrl: string,
  user: string,
  password: string,
  workspaceUrl: string,
  f: (
    client: TxOperations,
    uploader: FileUploader,
    ensurePerson: (email: string, firstName: string, lastName: string) => Promise<Ref<Person>>
  ) => Promise<void>
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
  const client = new TxOperations(connection, socialId)
  const uploader = new FrontFileUploader(
    frontUrl,
    selectedWs.workspace,
    selectedWs.workspaceDataId ?? selectedWs.workspace,
    selectedWs.token
  )
  // ensurePerson vive en la API REST del transactor: crea la persona y su identidad de email,
  // de modo que cuando esa persona se registre con el mismo email quede vinculada a este contacto.
  const restEndpoint = await getTransactorEndpoint(selectedWs.token, 'external')
  const restClient = createRestClient(restEndpoint, selectedWs.workspace, selectedWs.token)
  const ensurePerson = async (email: string, firstName: string, lastName: string): Promise<Ref<Person>> => {
    const { localPerson } = await restClient.ensurePerson(SocialIdType.EMAIL, email, firstName, lastName)
    return localPerson as Ref<Person>
  }

  try {
    await f(client, uploader, ensurePerson)
  } finally {
    await connection.close()
  }
}
