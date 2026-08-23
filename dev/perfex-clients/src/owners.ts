//
// Promover owners explícitos del workspace.
//
import { AccountRole, type AccountUuid, type TxOperations, type WorkspaceMemberInfo } from '@hcengineering/core'
import { getAccountClient } from '@hcengineering/server-client'

import { type Logger } from './import'
import { cargarCuentas, type Cuentas } from './permisos'

export interface OwnersOptions {
  /** Si es true sólo muestra qué cuentas se promoverían. */
  dryRun: boolean
}

export interface OwnersPlan {
  promover: AccountUuid[]
  invitar: string[]
}

/**
 * Separa cuentas promovibles de correos que todavía deben aceptar una invitación Owner.
 *
 * @throws si no se indicó ningún correo.
 */
export function planificarOwners (
  correos: string[],
  cuentas: Cuentas,
  miembros: WorkspaceMemberInfo[]
): OwnersPlan {
  const solicitados = [...new Set(correos.map((correo) => correo.trim().toLowerCase()).filter((correo) => correo !== ''))]
  if (solicitados.length === 0) throw new Error('Indicá al menos un --owner <correo>')

  const miembrosPorCuenta = new Map(miembros.map((miembro) => [miembro.person, miembro]))
  const promover: AccountUuid[] = []
  const invitar: string[] = []
  for (const correo of solicitados) {
    const account = cuentas.porCorreo.get(correo)
    const miembro = account === undefined ? undefined : miembrosPorCuenta.get(account)
    if (account === undefined || miembro === undefined) {
      invitar.push(correo)
    } else if (miembro.role !== AccountRole.Owner) {
      promover.push(account)
    }
  }
  return { promover, invitar }
}

/**
 * Promueve a owner las cuentas explícitamente pedidas, sin degradar ningún rol existente.
 *
 * @returns cantidad de cuentas promovidas, o que se promoverían en simulación.
 */
export async function asignarOwners (
  client: TxOperations,
  token: string,
  logger: Logger,
  correos: string[],
  options: OwnersOptions
): Promise<number> {
  const cuentas = await cargarCuentas(client)
  const accountClient = getAccountClient(token)
  const plan = planificarOwners(correos, cuentas, await accountClient.getWorkspaceMembers())
  const cambios = plan.promover.length + plan.invitar.length

  if (cambios === 0) {
    logger.log('Los owners indicados ya están configurados.')
    return 0
  }

  const nombres = plan.promover.map((account) => cuentas.nombres.get(account) ?? account).join(', ')
  if (plan.promover.length > 0) {
    logger.log(`${plan.promover.length} accounts a promover a owner: ${nombres}${options.dryRun ? ' (simulado)' : ''}`)
  }
  if (plan.invitar.length > 0) {
    logger.log(
      `${plan.invitar.length} owners sin cuenta o membresía: se enviará invitación Owner a ${plan.invitar.join(', ')}` +
        (options.dryRun ? ' (simulado)' : '')
    )
  }
  if (options.dryRun) return cambios

  for (const account of plan.promover) {
    await accountClient.updateWorkspaceRole(account, AccountRole.Owner)
    logger.log(`  owner promovido: ${cuentas.nombres.get(account) ?? account}`)
  }
  for (const correo of plan.invitar) {
    await accountClient.resendInvite(correo, AccountRole.Owner)
    logger.log(`  invitación owner enviada: ${correo}; la cuenta se activa al aceptarla`)
  }
  return cambios
}
