import { type PerfexQueryEvent, getPerfexConfig, PerfexReader } from '@hcengineering/perfex'
import { readFileSync } from 'node:fs'

import { getEnvironment } from './environments'
import { importClients, type Logger } from './import'
import { withHulyClient } from './index'
import { asignarOwners } from './owners'
import { aplicarPermisos } from './permisos'
import {
  archivarAusentes,
  buscarDuplicados,
  duplicadosSinResolver,
  idsDelAmbiente,
  readDuplicateMap,
  readSyncConfig
} from './sync'
import { isImportStage, type ControlStage } from './sync-control'

export class MigrationCancelledError extends Error {
  constructor () {
    super('Detención solicitada por el operador')
    this.name = 'MigrationCancelledError'
  }
}

export interface SyncStepOptions {
  configPath: string
  environmentId: string
  stage: ControlStage
  dryRun: boolean
  logger: Logger
  onQuery: (event: PerfexQueryEvent) => void
  shouldStop: () => boolean
}

/** Ejecuta una sola etapa y un solo workspace; toda la selección vive fuera de este worker. */
export async function runSyncStep (options: SyncStepOptions): Promise<void> {
  const config = readSyncConfig(options.configPath)
  const destination = config.workspaces.find(({ env }) => env === options.environmentId)
  if (destination === undefined) throw new Error(`Workspace no configurado: ${options.environmentId}`)

  const environment = getEnvironment(destination.env)
  const token = process.env[destination.tokenEnv]
  if (token === undefined || token === '') throw new Error(`Falta la variable ${destination.tokenEnv}`)

  const assertRunning = (): void => {
    if (options.shouldStop()) throw new MigrationCancelledError()
  }
  const logger: Logger = {
    log: (message) => {
      options.logger.log(message)
      assertRunning()
    },
    error: (message) => {
      options.logger.error(message)
      assertRunning()
    }
  }
  const onQuery = (event: PerfexQueryEvent): void => {
    options.onQuery(event)
    if (event.phase !== 'error') assertRunning()
  }

  assertRunning()
  logger.log(`Inicio de ${options.stage} en ${destination.workspace}${options.dryRun ? ' (simulación)' : ''}`)
  const perfex = await PerfexReader.connect(getPerfexConfig(), onQuery)
  try {
    await withHulyClient(
      {
        frontUrl: config.front,
        workspaceUrl: destination.workspace,
        token,
        transactor: config.transactor
      },
      async (client, uploader, ensurePerson) => {
        assertRunning()
        const duplicateMap = readDuplicateMap(config.mapaDuplicados)

        if (options.stage === 'preflight') {
          const unresolved = duplicadosSinResolver(await buscarDuplicados(client), duplicateMap)
          if (unresolved.length > 0) {
            throw new Error(
              `Duplicados sin canónico: ${unresolved.map((item) => `${item.tipo}:${item.clave}`).join(', ')}`
            )
          }
          const source = idsDelAmbiente(
            environment,
            await perfex.getClients(),
            await perfex.getProjects(),
            await perfex.getTasks()
          )
          logger.log(`Preflight correcto: ${source.projectIds.size} proyectos y ${source.taskIds.size} tareas`)
          return
        }

        if (isImportStage(options.stage)) {
          await importClients(
            client,
            perfex,
            logger,
            {
              environment,
              stages: [options.stage],
              dryRun: options.dryRun,
              includeInactive: true,
              onlyOpenTasks: false,
              minTagUses: 1,
              attachmentsDir: config.dirAdjuntos ?? process.env.DIR_ADJUNTOS,
              includeClosedTaskCollaborators: true,
              canonicalOrganizations: duplicateMap.organizaciones,
              canonicalPeople: duplicateMap.personas
            },
            uploader,
            ensurePerson
          )
          return
        }

        if (options.stage === 'owners') {
          await asignarOwners(client, token, logger, destination.owners, { dryRun: options.dryRun })
          return
        }

        if (options.stage === 'permisos') {
          await aplicarPermisos(client, perfex, logger, readFileSync(config.permisosCsv, 'utf8'), {
            dryRun: options.dryRun
          })
          return
        }

        const source = idsDelAmbiente(
          environment,
          await perfex.getClients(),
          await perfex.getProjects(),
          await perfex.getTasks()
        )
        const archived = await archivarAusentes(client, source.projectIds, source.taskIds, options.dryRun)
        logger.log(
          `Archivado${options.dryRun ? ' planificado' : ''}: ${archived.proyectos} proyectos, ${archived.tareas} tareas`
        )
      }
    )
  } finally {
    await perfex.close()
  }
  logger.log(`Etapa ${options.stage} completada`)
}
