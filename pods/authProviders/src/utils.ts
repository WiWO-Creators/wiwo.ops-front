//
// Copyright © 2024 Hardcore Engineering, Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
import { AccountDB, joinWithProvider, LoginInfo, loginOrSignUpWithProvider } from '@hcengineering/account'
import { BrandingMap, concatLink, getBranding, MeasureContext, SocialKey } from '@hcengineering/core'
import { IncomingHttpHeaders } from 'http'
import qs from 'querystringify'

/**
 * Dominios de correo autorizados a entrar por un proveedor externo.
 * Lista vacia = sin restriccion, para no romper el desarrollo local.
 */
const ALLOWED_EMAIL_DOMAINS = new Set(
  (process.env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain !== '')
)

/**
 * Indica si el correo pertenece a un dominio autorizado.
 *
 * @param email correo devuelto por el proveedor de identidad
 * @returns true si la allowlist esta vacia o el dominio figura en ella
 */
export function isEmailDomainAllowed (email: string | undefined): boolean {
  if (ALLOWED_EMAIL_DOMAINS.size === 0) return true
  if (email == null || email === '') return false

  const parts = email.trim().toLowerCase().split('@')

  // Solo un `@`: un valor como `a@b@wiwo.me` no debe colar como dominio valido.
  return parts.length === 2 && ALLOWED_EMAIL_DOMAINS.has(parts[1])
}

/**
 * Indica si el dominio hospedado (`hd`) que declara Google esta autorizado.
 * Un `hd` ausente no invalida: las cuentas personales no lo traen y ya se
 * filtran por el dominio del correo.
 *
 * @param hd valor del claim `hd`
 */
export function isHostedDomainAllowed (hd: string | undefined): boolean {
  if (ALLOWED_EMAIL_DOMAINS.size === 0) return true
  if (hd == null || hd === '') return true

  return ALLOWED_EMAIL_DOMAINS.has(hd.toLowerCase())
}

/** Lista de dominios autorizados, para mensajes de error y diagnostico. */
export function getAllowedEmailDomains (): string[] {
  return [...ALLOWED_EMAIL_DOMAINS]
}

/**
 * Indica si un correo que ya paso la allowlist puede darse de alta.
 *
 * La allowlist de dominios es la politica de acceso: quien la pasa esta autorizado, asi
 * que se le crea la cuenta aunque el alta general este cerrada. Sin allowlist (desarrollo
 * local, donde cualquier correo entra) se respeta `DISABLE_SIGNUP` tal cual.
 *
 * @param signUpDisabled valor de `DISABLE_SIGNUP` con el que arranco el servicio
 * @returns true si el alta debe seguir bloqueada para este correo
 */
export function isSignUpBlocked (signUpDisabled: boolean | undefined): boolean {
  return signUpDisabled === true && ALLOWED_EMAIL_DOMAINS.size === 0
}

export function getHost (headers: IncomingHttpHeaders): string | undefined {
  let host: string | undefined
  const origin = headers.origin ?? headers.referer
  if (origin !== undefined) {
    host = new URL(origin).host
  }

  return host
}

export interface AuthState {
  inviteId?: string
  branding?: string
  autoJoin?: boolean
  navigateUrl?: string
}

export function safeParseAuthState (rawState: string | undefined): AuthState {
  if (rawState == null) {
    return {}
  }

  try {
    return JSON.parse(decodeURIComponent(rawState))
  } catch {
    return {}
  }
}

export function encodeState (ctx: any, brandings: BrandingMap): string {
  const host = getHost(ctx.request.headers)
  const branding = host !== undefined ? (brandings[host]?.key ?? undefined) : undefined
  const state: AuthState = {
    inviteId: ctx.query?.inviteId,
    branding,
    autoJoin: ctx.query?.autoJoin !== undefined,
    navigateUrl: ctx.query?.navigateUrl
  }

  return encodeURIComponent(JSON.stringify(state))
}

export async function handleProviderAuth (
  measureCtx: MeasureContext,
  db: AccountDB,
  brandings: BrandingMap,
  frontUrl: string,
  providerType: string,
  rawState: string | undefined,
  user: any,
  email: string | undefined,
  first: string,
  last: string,
  socialKey: SocialKey,
  signUpDisabled: boolean | undefined
): Promise<string> {
  try {
    measureCtx.info('Provider auth handler', { email, type: providerType })
    let loginInfo: LoginInfo | null
    const state = safeParseAuthState(rawState)
    const branding = getBranding(brandings, state?.branding)

    // Punto unico de control para los tres proveedores (google, github, openid):
    // un correo de un dominio no autorizado no llega a crear ni a resolver cuenta.
    if (!isEmailDomainAllowed(email)) {
      measureCtx.warn('Rejected auth: email domain not allowed', { email, type: providerType })

      return concatLink(branding?.front ?? frontUrl, '/login?authError=domain')
    }

    // El correo ya paso la allowlist, que hace de invitacion: el alta solo sigue
    // bloqueada si no hay dominios autorizados configurados.
    const signUpBlocked = isSignUpBlocked(signUpDisabled)

    if (state.inviteId != null && state.inviteId !== '' && state.autoJoin !== true) {
      loginInfo = await joinWithProvider(
        measureCtx,
        db,
        null,
        email,
        first,
        last,
        state.inviteId as any,
        socialKey,
        signUpBlocked
      )
    } else {
      loginInfo = await loginOrSignUpWithProvider(
        measureCtx,
        db,
        null,
        email,
        first,
        last,
        socialKey,
        signUpBlocked || state.autoJoin === true
      )
    }

    if (loginInfo === null) {
      measureCtx.info('Failed to auth: no associated account found', {
        email,
        type: providerType,
        user
      })
      return concatLink(branding?.front ?? frontUrl, '/login?authError=noaccount')
    } else {
      const origin = concatLink(branding?.front ?? frontUrl, '/login/auth')
      const queryObj: any = { token: loginInfo.token }
      if (state.autoJoin === true) {
        queryObj.autoJoin = state.autoJoin
        queryObj.inviteId = state.inviteId
        queryObj.navigateUrl = state.navigateUrl
      }

      const query = encodeURIComponent(qs.stringify(queryObj))

      // Successful authentication, redirect to your application
      measureCtx.info('Success auth, redirect', { email, type: providerType, target: origin })
      return `${origin}?${query}`
    }
  } catch (err: any) {
    measureCtx.error('failed to auth', { err, email, type: providerType, user })

    // Devolver cadena vacia dejaba al navegador sin redirect, en la URL del callback y
    // con una respuesta vacia. El fallo se explica en la pantalla de ingreso.
    return concatLink(frontUrl, '/login?authError=provider')
  }
}
