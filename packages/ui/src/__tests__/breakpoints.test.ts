//
// Copyright © 2026 WiWO.
//

import { deviceSizes, deviceWidths, getDeviceSize } from '../types'

declare const __dirname: string
declare const require: (module: 'fs' | 'path') => Record<string, (...args: any[]) => any>

const { existsSync, readFileSync } = require('fs')
const { join } = require('path')

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

  it.each([
    [0, 'xs'],
    [480, 'xs'],
    [481, 'sm'],
    [680, 'sm'],
    [681, 'md'],
    [760, 'md'],
    [761, 'lg'],
    [1024, 'lg'],
    [1025, 'xl'],
    [1208, 'xl'],
    [1209, 'xxl']
  ] as const)('clasifica %dpx en %s', (width, expected) => {
    expect(getDeviceSize(width)).toBe(expected)
  })

  it('cubre todos los breakpoints declarados', () => {
    expect(deviceSizes).toEqual(['xs', 'sm', 'md', 'lg', 'xl', 'xxl'])
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rechaza ancho inválido %s', (width) => {
    expect(() => getDeviceSize(width)).toThrow(RangeError)
  })
})
