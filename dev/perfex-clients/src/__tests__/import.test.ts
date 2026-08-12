import { belongsToEnvironment, getEnvironment, resolveEnvironment } from '../environments'
import { buildContactName } from '../import'
import { extractUrl, type PerfexContact } from '../perfex'

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
