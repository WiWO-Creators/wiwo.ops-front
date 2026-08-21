import { belongsToEnvironment, getEnvironment, resolveEnvironment } from '../environments'
import { buildContactName } from '../import'
import { parseSince } from '../index'
import { extractUrl, type PerfexContact } from '@hcengineering/perfex'

describe('reparto en ambientes', () => {
  const mgc = getEnvironment('mgc')
  const wiwo = getEnvironment('wiwo')
  const sinClasificar = getEnvironment('sin-clasificar')

  it('manda cada grupo a su ambiente', () => {
    expect(belongsToEnvironment(['MGC HQ'], mgc)).toBe(true)
    expect(belongsToEnvironment(['Aima'], mgc)).toBe(true)
    expect(belongsToEnvironment(['WIWO'], wiwo)).toBe(true)
    expect(belongsToEnvironment(['WIWO'], mgc)).toBe(false)
  })

  it('tolera espacios y mayúsculas del nombre del grupo', () => {
    expect(belongsToEnvironment(['MGC HQ '], mgc)).toBe(true)
    expect(belongsToEnvironment(['wiwo'], wiwo)).toBe(true)
  })

  it('manda a un solo ambiente al cliente que está en dos grupos', () => {
    // Hay clientes en MGC HQ y WIWO a la vez: si entraran en los dos, se duplicarían.
    expect(belongsToEnvironment(['MGC HQ', 'WIWO'], wiwo)).toBe(true)
    expect(belongsToEnvironment(['MGC HQ', 'WIWO'], mgc)).toBe(false)
  })

  it('deja en sin clasificar a los clientes sin grupo o con grupos que nadie reclama', () => {
    expect(resolveEnvironment([]).id).toBe('sin-clasificar')
    expect(belongsToEnvironment(['Grupo nuevo'], sinClasificar)).toBe(true)
    expect(belongsToEnvironment(['MGC HQ'], sinClasificar)).toBe(false)
  })

  it('rechaza ambientes inexistentes', () => {
    expect(() => getEnvironment('otro')).toThrow()
  })
})

describe('datos del cliente', () => {
  const contact = (over: Partial<PerfexContact>): PerfexContact => ({
    id: 7,
    clientId: 1,
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    isPrimary: true,
    ...over
  })

  it('arma el nombre del contacto', () => {
    expect(buildContactName(contact({ firstName: 'Ana', lastName: 'Pérez' }))).toBe('Ana Pérez')
    expect(buildContactName(contact({ firstName: 'Ana' }))).toBe('Ana')
  })

  it('cae al email y después al id cuando no hay nombre', () => {
    expect(buildContactName(contact({ email: 'a@x.com' }))).toBe('a@x.com')
    expect(buildContactName(contact({}))).toBe('Contacto 7')
  })

  it('extrae la url del enlace de Drive, que Perfex guarda como html', () => {
    expect(extractUrl('<a href="https://drive.google.com/x" target="_blank">Carpeta</a>')).toBe(
      'https://drive.google.com/x'
    )
    expect(extractUrl(' https://drive.google.com/y ')).toBe('https://drive.google.com/y')
    expect(extractUrl('<span>sin link</span>')).toBe('sin link')
  })
})

describe('recorte por fecha', () => {
  it('acepta una fecha en formato AAAA-MM-DD', () => {
    const since = parseSince('2026-08-01', undefined)
    expect(new Date(since as number).getFullYear()).toBe(2026)
    expect(new Date(since as number).getMonth()).toBe(7)
  })

  it('convierte una cantidad de meses en fecha', () => {
    const since = parseSince(undefined, '3') as number
    const esperado = new Date()
    esperado.setMonth(esperado.getMonth() - 3)
    // Un día de tolerancia alcanza: sólo importa que caiga en el mes correcto.
    expect(Math.abs(since - esperado.getTime())).toBeLessThan(24 * 60 * 60 * 1000)
  })

  it('sin recorte devuelve indefinido', () => {
    expect(parseSince(undefined, undefined)).toBeUndefined()
    expect(parseSince('', '')).toBeUndefined()
  })

  it('rechaza valores que no se entienden, para no migrar de más por un tipeo', () => {
    expect(() => parseSince('01/08/2026', undefined)).toThrow('Fecha inválida')
    expect(() => parseSince(undefined, 'tres')).toThrow('inválida')
    expect(() => parseSince(undefined, '-2')).toThrow('inválida')
  })
})
