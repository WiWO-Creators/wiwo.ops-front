import { type AccountDB } from '@hcengineering/account'
import { type ProviderInfo } from '@hcengineering/account-client'
import { BrandingMap, concatLink, MeasureContext, getBranding, SocialIdType } from '@hcengineering/core'
import Router from 'koa-router'
import { Strategy as GoogleStrategy, type Profile, type VerifyCallback } from 'passport-google-oauth20'
import { Passport } from '.'
import { encodeState, handleProviderAuth, isEmailDomainAllowed, isHostedDomainAllowed, safeParseAuthState } from './utils'

/** Emisores validos de un id_token de Google. */
const GOOGLE_ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com'])

interface GoogleIdTokenClaims {
  iss?: string
  aud?: string | string[]
  email?: string
  email_verified?: boolean | string
  hd?: string
}

/**
 * Lee los claims de un id_token sin verificar la firma.
 *
 * El token llega directo del token endpoint de Google en una llamada servidor a
 * servidor sobre TLS, caso en el que OpenID Connect Core 3.1.3.7 permite omitir
 * la verificacion de firma. Por eso no hace falta sumar `google-auth-library`.
 *
 * @param idToken JWT compacto devuelto por el token endpoint
 * @returns los claims, o undefined si el token no es legible
 */
function readIdTokenClaims (idToken: string | undefined): GoogleIdTokenClaims | undefined {
  if (idToken == null || idToken === '') return undefined

  const payload = idToken.split('.')[1]
  if (payload === undefined) return undefined

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Valida los claims del id_token contra el cliente OAuth propio y la allowlist
 * de dominios.
 *
 * @param claims claims ya decodificados
 * @param clientId Client ID de la aplicacion, esperado en `aud`
 * @returns undefined si son validos, o el motivo del rechazo
 */
function checkIdTokenClaims (claims: GoogleIdTokenClaims, clientId: string): string | undefined {
  if (claims.iss === undefined || !GOOGLE_ISSUERS.has(claims.iss)) return 'issuer'

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(clientId)) return 'audience'

  // Google serializa email_verified como booleano en el id_token y como cadena
  // en algunas respuestas de userinfo.
  if (claims.email_verified !== true && claims.email_verified !== 'true') return 'email_not_verified'

  if (!isEmailDomainAllowed(claims.email)) return 'domain'
  if (!isHostedDomainAllowed(claims.hd)) return 'domain'

  return undefined
}

export function registerGoogle (
  measureCtx: MeasureContext,
  passport: Passport,
  router: Router<any, any>,
  accountsUrl: string,
  dbPromise: Promise<AccountDB>,
  frontUrl: string,
  brandings: BrandingMap,
  signUpDisabled?: boolean
): ProviderInfo | undefined {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
  const name = 'google'
  const displayName = process.env.GOOGLE_DISPLAY_NAME

  const redirectURL = '/auth/google/callback'
  if (GOOGLE_CLIENT_ID === undefined || GOOGLE_CLIENT_SECRET === undefined) return
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: concatLink(accountsUrl, redirectURL),
        passReqToCallback: true
      },
      // La aridad de 6 es obligatoria: passport-oauth2 solo entrega `params`
      // —donde viene el id_token, que no figura en los tipos del paquete aunque Google
      // lo devuelve siempre que se pide el scope `openid`— cuando la funcion lo declara.
      function (
        req: unknown,
        accessToken: string,
        refreshToken: string,
        params: { id_token?: string } | undefined,
        profile: Profile,
        done: VerifyCallback
      ) {
        const claims = readIdTokenClaims(params?.id_token)
        const rejection = claims === undefined ? 'id_token' : checkIdTokenClaims(claims, GOOGLE_CLIENT_ID)

        if (rejection !== undefined) {
          measureCtx.warn('Rejected auth: id_token check failed', {
            provider: 'google',
            reason: rejection,
            email: claims?.email,
            hd: claims?.hd
          })
        }

        // El rechazo viaja con el perfil en vez de cortar aqui con `done(null, false)`:
        // el `failureRedirect` de passport es una URL fija y no permite explicarle
        // al usuario por que se le nego el acceso.
        done(null, { ...profile, rejection })
      }
    )
  )

  router.get('/auth/google', async (ctx, next) => {
    measureCtx.info('try auth via', { provider: 'google' })
    const state = encodeState(ctx, brandings)

    passport.authenticate('google', { scope: ['openid', 'profile', 'email'], session: true, state })(ctx, next)
  })

  router.get(
    redirectURL,
    async (ctx, next) => {
      const state = safeParseAuthState(ctx.query?.state)
      measureCtx.info('Auth state', { state })
      const branding = getBranding(brandings, state?.branding)
      measureCtx.info('With branding', { branding })
      // Con `/login` a secas —el caso de quien cancela en la pantalla de Google— la
      // vuelta era muda y no se distinguia de no haber intentado entrar.
      const failureRedirect = concatLink(branding?.front ?? frontUrl, '/login?authError=provider')
      measureCtx.info('With failure redirect', { failureRedirect })
      try {
        await passport.authenticate('google', {
          failureRedirect,
          session: true
        })(ctx, next)
      } catch (err: any) {
        // Passport propaga como excepcion cualquier fallo del intercambio del codigo
        // con Google (red, credenciales, reloj desfasado). Sin este catch, Koa
        // responde un 500 en blanco y el usuario queda sin explicacion ni rastro.
        measureCtx.error('Failed provider auth', { provider: 'google', err })
        ctx.redirect(failureRedirect)
      }
    },
    async (ctx, next) => {
      const rejection: string | undefined = ctx.state.user?.rejection

      if (rejection !== undefined) {
        const state = safeParseAuthState(ctx.query?.state)
        const branding = getBranding(brandings, state?.branding)
        const authError = rejection === 'domain' ? 'domain' : 'provider'

        ctx.redirect(concatLink(branding?.front ?? frontUrl, `/login?authError=${authError}`))
        await next()
        return
      }

      measureCtx.info('Provider auth success', { type: 'google', user: ctx.state?.user })
      const email = ctx.state.user?.emails?.[0]?.value
      // Google no garantiza `name`: una cuenta sin nombre cargado llegaba aca y
      // rompia con un TypeError, que terminaba en el mismo 500 en blanco.
      const first = ctx.state.user?.name?.givenName ?? ''
      const last = ctx.state.user?.name?.familyName ?? ''
      const db = await dbPromise

      const redirectUrl = await handleProviderAuth(
        measureCtx,
        db,
        brandings,
        frontUrl,
        'google',
        ctx.query?.state,
        ctx.state?.user,
        email,
        first,
        last,
        { type: SocialIdType.GOOGLE, value: email },
        signUpDisabled
      )

      if (redirectUrl !== '') {
        ctx.redirect(redirectUrl)
      }

      await next()
    }
  )

  return { name, displayName }
}
