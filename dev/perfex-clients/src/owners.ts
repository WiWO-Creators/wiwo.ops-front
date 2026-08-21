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

/**
 * Valida los correos pedidos y devuelve sólo las cuentas que todavía no son owner.
 *
 * @throws si no se indicó un correo, no existe una cuenta o la cuenta no es miembro del workspace.
 */
export function planificarOwners (
  correos: string[],
  cuentas: Cuentas,
  miembros: WorkspaceMemberInfo[]
): AccountUuid[] {
  const solicitados = [...new Set(correos.map((correo) => correo.trim().toLowerCase()).filter((correo) => correo !== ''))]
  if (solicitados.length === 0) throw new Error('Indicá al menos un --owner <correo>')

  const faltanCuenta = solicitados.filter((correo) => !cuentas.porCorreo.has(correo))
  if (faltanCuenta.length > 0) {
    throw new Error(`Los owners no tienen cuenta en el workspace: ${faltanCuenta.join(', ')}`)
  }

  const cuentasSolicitadas = solicitados.map((correo) => cuentas.porCorreo.get(correo) as AccountUuid)
  const miembrosPorCuenta = new Map(miembros.map((miembro) => [miembro.person, miembro]))
  const faltanMiembros = cuentasSolicitadas.filter((account) => !miembrosPorCuenta.has(account))
  if (faltanMiembros.length > 0) {
    throw new Error(`Los owners deben ser miembros del workspace antes de promoverlos: ${faltanMiembros.join(', ')}`)
  }

  return cuentasSolicitadas.filter((account) => miembrosPorCuenta.get(account)?.role !== AccountRole.Owner)
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
  const cambios = planificarOwners(correos, cuentas, await accountClient.getWorkspaceMembers())

  if (cambios.length === 0) {
    logger.log('Los owners indicados ya están configurados.')
    return 0
  }

  const nombres = cambios.map((account) => cuentas.nombres.get(account) ?? account).join(', ')
  logger.log(`${cambios.length} accounts a promover a owner: ${nombres}${options.dryRun ? ' (simulado)' : ''}`)
  if (options.dryRun) return cambios.length

  for (const account of cambios) {
    await accountClient.updateWorkspaceRole(account, AccountRole.Owner)
    logger.log(`  owner promovido: ${cuentas.nombres.get(account) ?? account}`)
  }
  return cambios.length
}
