//
// Copyright © 2026 WiWO.
//

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { deviceWidths } from '../types'

/**
 * Los cortes de pantalla viven dos veces: en `deviceWidths` (los usa el store de dispositivo) y en
 * `packages/theme/styles/_breakpoints.scss` (los usa el CSS). Si se separan, el layout empieza a
 * cambiar de modo en un ancho y a cambiar de estilos en otro, que es justo el tipo de bug que no se
 * ve hasta que alguien abre la app en un telefono.
 */
describe('breakpoints', () => {
  const scssPath = join(__dirname, '../../../theme/styles/_breakpoints.scss')

  it('el archivo de breakpoints del tema existe', () => {
    expect(existsSync(scssPath)).toBe(true)
  })

  it('los valores de SCSS son los mismos que deviceWidths', () => {
    const scss = readFileSync(scssPath, 'utf-8')
    const fromScss = [...scss.matchAll(/^\$bp-[a-z]+:\s*(\d+)px;/gm)].map((m) => parseInt(m[1], 10))
    // `deviceWidths` cierra con -1, que es "de aca para arriba" y no tiene equivalente en CSS.
    const fromTs = deviceWidths.filter((w) => w > 0)

    expect(fromScss).toEqual(fromTs)
  })
})
