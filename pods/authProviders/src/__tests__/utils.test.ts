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

// La politica de dominios es pura, pero vive junto al resto de `utils`, que arrastra el
// servicio de cuentas. Se sustituye para que el test corra sin compilar el monorepo.
jest.mock('@hcengineering/account', () => ({}), { virtual: true })

/**
 * La allowlist se lee al cargar el modulo, asi que cada caso necesita una carga limpia
 * con su propio valor de `ALLOWED_EMAIL_DOMAINS`.
 */
function loadUtils (allowedDomains?: string): typeof import('../utils') {
  jest.resetModules()

  if (allowedDomains === undefined) {
    delete process.env.ALLOWED_EMAIL_DOMAINS
  } else {
    process.env.ALLOWED_EMAIL_DOMAINS = allowedDomains
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../utils')
}

describe('politica de alta por dominio', () => {
  const originalDomains = process.env.ALLOWED_EMAIL_DOMAINS

  afterEach(() => {
    if (originalDomains === undefined) {
      delete process.env.ALLOWED_EMAIL_DOMAINS
    } else {
      process.env.ALLOWED_EMAIL_DOMAINS = originalDomains
    }
  })

  it('permite el alta de un dominio autorizado aunque DISABLE_SIGNUP este activo', () => {
    const { isSignUpBlocked, isEmailDomainAllowed } = loadUtils('wiwo.me,mgcglobalgroup.com')

    expect(isEmailDomainAllowed('alguien@wiwo.me')).toBe(true)
    expect(isSignUpBlocked(true)).toBe(false)
  })

  it('respeta DISABLE_SIGNUP cuando no hay allowlist configurada', () => {
    const { isSignUpBlocked } = loadUtils('')

    expect(isSignUpBlocked(true)).toBe(true)
    expect(isSignUpBlocked(false)).toBe(false)
    expect(isSignUpBlocked(undefined)).toBe(false)
  })

  it('rechaza un correo fuera de la allowlist antes de llegar al alta', () => {
    const { isEmailDomainAllowed } = loadUtils('wiwo.me')

    expect(isEmailDomainAllowed('alguien@gmail.com')).toBe(false)
    expect(isEmailDomainAllowed('alguien@a@wiwo.me')).toBe(false)
    expect(isEmailDomainAllowed(undefined)).toBe(false)
  })

  it('no restringe el dominio hospedado si no hay allowlist', () => {
    const { isHostedDomainAllowed } = loadUtils('')

    expect(isHostedDomainAllowed('cualquiera.com')).toBe(true)
  })

  it('acepta un hd ausente y rechaza uno fuera de la allowlist', () => {
    const { isHostedDomainAllowed } = loadUtils('wiwo.me')

    expect(isHostedDomainAllowed(undefined)).toBe(true)
    expect(isHostedDomainAllowed('WIWO.ME')).toBe(true)
    expect(isHostedDomainAllowed('otra.com')).toBe(false)
  })
})
