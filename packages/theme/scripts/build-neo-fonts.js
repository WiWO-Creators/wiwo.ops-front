/*
 * Descarga las fuentes del sistema Neo desde Google Fonts y genera el SCSS
 * con los @font-face apuntando a los archivos locales.
 *
 * Uso, desde packages/theme:
 *   node scripts/build-neo-fonts.js fonts/neo styles/_neo-fonts.scss
 *
 * Las familias variables (Plus Jakarta Sans, Outfit) reparten la misma URL
 * entre todos los pesos pedidos: se colapsan en un unico @font-face con rango
 * de peso. Las estaticas (Tomorrow) conservan un @font-face por peso.
 */

const fs = require('fs')
const path = require('path')
const https = require('https')

const GOOGLE_FONTS_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700' +
  '&family=Outfit:wght@500;600;700&family=Tomorrow:wght@400;500;600&display=swap'

// La API sirve woff2 solo a navegadores modernos; con el UA por defecto de
// Node devuelve ttf.
const MODERN_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

const [, , fontsDir, scssPath] = process.argv
if (fontsDir == null || scssPath == null) {
  console.error('uso: node scripts/build-neo-fonts.js <dir-fuentes> <archivo-scss>')
  process.exit(1)
}

// Rango de peso declarado por familia variable. Ausente = fuente estatica.
const VARIABLE_WEIGHT_RANGE = {
  'Plus Jakarta Sans': '200 800',
  Outfit: '100 900'
}

const SLUG = {
  'Plus Jakarta Sans': 'PlusJakartaSans',
  Outfit: 'Outfit',
  Tomorrow: 'Tomorrow'
}

/** Extrae los bloques @font-face del CSS de Google Fonts. */
function parseFaces (css) {
  const faces = []
  const blockRe = /\/\* ([a-z-]+) \*\/\s*@font-face \{([^}]+)\}/g
  let match
  while ((match = blockRe.exec(css)) !== null) {
    const [, subset, body] = match
    const field = (name) => {
      const found = new RegExp(`${name}:\\s*([^;]+);`).exec(body)
      return found === null ? null : found[1].trim()
    }
    const url = /src:\s*url\(([^)]+)\)/.exec(body)
    if (url === null) continue
    faces.push({
      subset,
      family: (field('font-family') ?? '').replace(/'/g, ''),
      style: field('font-style') ?? 'normal',
      weight: field('font-weight') ?? '400',
      unicodeRange: field('unicode-range'),
      url: url[1]
    })
  }
  return faces
}

function get (url, headers = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`${url}: HTTP ${res.statusCode}`))
          return
        }
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => { resolve(Buffer.concat(chunks)) })
        res.on('error', reject)
      })
      .on('error', reject)
  })
}

/** Colapsa los pesos repetidos de una familia variable en un unico face. */
function collapse (faces) {
  const out = []
  const seen = new Map()
  for (const face of faces) {
    const range = VARIABLE_WEIGHT_RANGE[face.family]
    if (range === undefined) {
      out.push(face)
      continue
    }
    if (seen.has(face.url)) continue
    seen.set(face.url, true)
    out.push({ ...face, weight: range })
  }
  return out
}

async function main () {
  const css = (await get(GOOGLE_FONTS_CSS_URL, { 'User-Agent': MODERN_BROWSER_UA })).toString('utf8')
  const faces = collapse(parseFaces(css))
  if (faces.length === 0) throw new Error('la API de Google Fonts no devolvio ningun @font-face')

  fs.mkdirSync(fontsDir, { recursive: true })

  const blocks = []
  for (const face of faces) {
    const slug = SLUG[face.family]
    if (slug === undefined) throw new Error(`familia sin slug: ${face.family}`)
    const weightTag = face.weight.replace(/\s+/g, '-')
    const filename = `${slug}-${weightTag}-${face.subset}.woff2`
    fs.writeFileSync(path.join(fontsDir, filename), await get(face.url))
    blocks.push(
      [
        '@font-face {',
        `  font-family: '${face.family}';`,
        `  font-style: ${face.style};`,
        `  font-weight: ${face.weight};`,
        '  font-display: swap;',
        // Sin local(): una copia estatica instalada en el sistema secuestraria
        // los ejes de las familias variables y rompiera los pesos intermedios.
        `  src: url('../fonts/neo/${filename}') format('woff2');`,
        face.unicodeRange === null ? null : `  unicode-range: ${face.unicodeRange};`,
        '}'
      ]
        .filter((line) => line !== null)
        .join('\n')
    )
  }

  const header = `//
// Fuentes del sistema de diseño Neo (https://neo.wiwo.me), self-hosted.
//
// Plus Jakarta Sans: interfaz. Outfit: titulares. Tomorrow: monoespaciada.
// Generado desde la API de Google Fonts; los .woff2 viven en ../fonts/neo/.
// No editar a mano: regenerar con scripts/build-neo-fonts.js.
//
`
  fs.writeFileSync(scssPath, `${header}\n${blocks.join('\n')}\n`)
  console.log(`${faces.length} @font-face -> ${scssPath}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
