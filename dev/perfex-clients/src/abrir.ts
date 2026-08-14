//
// Abrir los proyectos al equipo.
//
// Un proyecto sin miembros aparece en el menú pero sus tareas no se ven: para los datos, Huly no
// se conforma con que el espacio sea público. Esto suma a todo el equipo como miembro y deja los
// proyectos en modo "se suman solos", para que quien entre al workspace más adelante también los
// vea sin que nadie tenga que acordarse de invitarlo.
//
import { type AccountUuid, type TxOperations } from '@hcengineering/core'
import tracker from '@hcengineering/tracker'

import { getWorkspaceMembers, type Logger } from './import'

export interface OpenOptions {
  /** Si es true no escribe nada: sólo informa qué cambiaría. */
  dryRun: boolean
}

/**
 * Suma al equipo como miembro de cada proyecto del workspace.
 *
 * @returns cuántos proyectos se modificaron.
 */
export async function openProjects (client: TxOperations, logger: Logger, options: OpenOptions): Promise<number> {
  const members = await getWorkspaceMembers(client)
  if (members.length === 0) {
    throw new Error('No se encontró ninguna persona con cuenta en el workspace')
  }

  const projects = await client.findAll(tracker.class.Project, {})
  logger.log(`${projects.length} proyectos, ${members.length} personas con cuenta`)

  let changed = 0
  for (const project of projects) {
    const missing = members.filter((m) => !project.members.includes(m))
    const needsAutoJoin = project.autoJoin !== true
    if (missing.length === 0 && !needsAutoJoin) continue

    if (!options.dryRun) {
      await client.update(project, {
        members: [...project.members, ...missing] as AccountUuid[],
        autoJoin: true
      })
    }
    changed++
    logger.log(`  ${project.name}: ${missing.length} miembros nuevos${needsAutoJoin ? ', se suman solos' : ''}`)
  }

  logger.log(`Proyectos abiertos al equipo: ${changed}${options.dryRun ? ' (simulado)' : ''}`)
  return changed
}
