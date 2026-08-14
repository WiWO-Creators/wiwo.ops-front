//
// Crear la invitación permanente de un workspace.
//
// La pantalla de ingreso ofrece los workspaces configurados en `branding.json`, y para cada uno
// necesita el identificador de una invitación sin vencimiento ni límite de usos. La interfaz de
// Huly no deja crear invitaciones así, pero el servicio de cuentas sí las acepta.
//
import { AccountRole } from '@hcengineering/core'
import { getAccountClient } from '@hcengineering/server-client'

import { type Logger } from './import'

/** Sin vencimiento y sin tope de usos: así lo entiende el servicio de cuentas. */
const NO_EXPIRA = -1
const SIN_LIMITE = -1

/**
 * Crea una invitación permanente para el workspace del token y devuelve su identificador.
 *
 * @param token token del workspace, de una cuenta con permiso para invitar.
 * @param role rol con el que entrará quien use la invitación.
 */
export async function createPermanentInvite (
  token: string,
  logger: Logger,
  role: AccountRole = AccountRole.User
): Promise<string> {
  const inviteId = await getAccountClient(token).createInvite(NO_EXPIRA, '', SIN_LIMITE, role)

  logger.log('Invitación creada: no vence y admite usos ilimitados.')
  logger.log(`inviteId: ${inviteId}`)
  logger.log('Copialo a "joinableWorkspaces" en dev/prod/public/branding.json.')

  return inviteId
}
