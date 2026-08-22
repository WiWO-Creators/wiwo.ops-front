import { withHulyClient } from './index'
import { cleanWorkspace, type CleanResult } from './limpiar'
import { MigrationCancelledError } from './sync-step'
import { readSyncConfig } from './sync'

export interface CleanupStepOptions {
  configPath: string
  environmentId: string
  dryRun: boolean
  expected?: CleanResult
  logger: { log: (message: string) => void, error: (message: string) => void }
  shouldStop: () => boolean
}

/** Ejecuta la vista previa o limpieza de un workspace sin conectarse a Perfex. */
export async function runCleanupStep (options: CleanupStepOptions): Promise<CleanResult> {
  const config = readSyncConfig(options.configPath)
  const destination = config.workspaces.find(({ env }) => env === options.environmentId)
  if (destination === undefined) throw new Error(`Workspace no configurado: ${options.environmentId}`)

  const token = process.env[destination.tokenEnv]
  if (token === undefined || token === '') throw new Error(`Falta la variable ${destination.tokenEnv}`)

  const assertRunning = (): void => {
    if (options.shouldStop()) throw new MigrationCancelledError()
  }
  assertRunning()
  options.logger.log(
    `${options.dryRun ? 'Vista previa de limpieza' : 'Limpieza irreversible'} en ${destination.workspace}`
  )

  let result: CleanResult | undefined
  await withHulyClient(
    {
      frontUrl: config.front,
      workspaceUrl: destination.workspace,
      token,
      transactor: config.transactor
    },
    async (client) => {
      result = await cleanWorkspace(client, options.logger, {
        dryRun: options.dryRun,
        expected: options.expected,
        assertRunning
      })
    }
  )
  if (result === undefined) throw new Error('La limpieza terminó sin entregar conteos')
  options.logger.log(options.dryRun ? 'Vista previa lista para confirmar' : 'Workspace limpiado')
  return result
}
