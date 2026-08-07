/*
 * Comprueba el contraste WCAG de los pares texto/superficie del tema Neo
 * leyendo el CSS ya compilado. Falla si algun par de texto normal baja de
 * 4.5:1 (AA) o si un texto terciario baja de 3:1.
 *
 * Uso, desde packages/theme:
 *   npx sass --load-path=styles styles/global.scss /tmp/theme.css
 *   node scripts/check-contrast.js /tmp/theme.css
 */

const fs = require('fs')

const css = fs.readFileSync(process.argv[2], 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Devuelve los cuerpos de las reglas cuyo selector completo es el indicado. */
function ruleBodies (selector) {
  const out = []
  const re = new RegExp(`(?:^|[};])\\s*${selector.replace('.', '\\.')}\\s*\\{([^{}]*)\\}`, 'gm')
  let m
  while ((m = re.exec(css)) !== null) out.push(m[1])
  return out
}

/** Resuelve una variable en un selector, con herencia desde `*`. */
function resolve (name, selector, seen = new Set()) {
  if (seen.has(name)) return null
  seen.add(name)
  for (const scope of [selector, '\\*']) {
    for (const body of ruleBodies(scope).reverse()) {
      const m = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(body)
      if (m === null) continue
      const value = m[1].trim()
      const ref = /^var\((--[\w-]+)\)$/.exec(value)
      return ref === null ? value : resolve(ref[1], selector, seen)
    }
  }
  return null
}

/** Convierte #rgb, #rrggbb o rgba(...) a [r,g,b,a]. */
function parseColor (value) {
  if (value == null) return null
  const hex = /^#([0-9a-f]{3,8})$/i.exec(value.trim())
  if (hex !== null) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    const n = (i) => parseInt(h.slice(i, i + 2), 16)
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1]
  }
  const rgb = /rgba?\(([^)]+)\)/.exec(value)
  if (rgb === null) return null
  const p = rgb[1].split(',').map((s) => parseFloat(s))
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
}

/** Compone un color con alfa sobre un fondo opaco. */
const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))

const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio (fgValue, bgValue, theme) {
  const bg = parseColor(resolve(bgValue, theme))
  const fg = parseColor(resolve(fgValue, theme))
  if (bg === null || fg === null) return null
  const bgSolid = bg[3] === 1 ? bg.slice(0, 3) : over(bg, [255, 255, 255])
  const l1 = luminance(over(fg, bgSolid))
  const l2 = luminance(bgSolid)
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]
  return (hi + 0.05) / (lo + 0.05)
}

// [texto, fondo, minimo exigido]
const PAIRS = [
  ['--theme-caption-color', '--theme-bg-color', 4.5],
  ['--theme-content-color', '--theme-bg-color', 4.5],
  ['--theme-halfcontent-color', '--theme-bg-color', 3],
  ['--global-primary-TextColor', '--global-surface-02-BackgroundColor', 4.5],
  ['--global-secondary-TextColor', '--global-surface-01-BackgroundColor', 4.5],
  ['--global-tertiary-TextColor', '--global-surface-01-BackgroundColor', 3],
  ['--theme-caption-color', '--theme-popup-color', 4.5],
  ['--theme-content-color', '--theme-navpanel-color', 4.5],
  ['--primary-button-color', '--primary-button-default', 4.5],
  ['--theme-link-color', '--theme-bg-color', 4.5],
  ['--global-error-TextColor', '--global-surface-02-BackgroundColor', 4.5]
]

let failures = 0
let unresolved = 0
for (const theme of ['.theme-light', '.theme-dark']) {
  console.log(`\n${theme}`)
  for (const [fg, bg, min] of PAIRS) {
    const r = ratio(fg, bg, theme)
    if (r === null) {
      console.log(`  ??  ${fg} sobre ${bg}: no resuelto`)
      unresolved++
      continue
    }
    const ok = r >= min
    if (!ok) failures++
    console.log(`  ${ok ? 'ok' : 'FALLA'}  ${r.toFixed(2)}:1 (min ${min})  ${fg} sobre ${bg}`)
  }
}

console.log(`\nfallos: ${failures}, sin resolver: ${unresolved}`)
process.exit(failures > 0 ? 1 : 0)
