import { buildIssueDescription } from '../import'
import { belongsToEnvironment, buildProjectIdentifier, getEnvironment, getPriorityName, getStatusName } from '../mapping'
import { extractUrl, type PerfexStaff, type PerfexTask } from '../perfex'

describe('mapeo de Perfex a Huly', () => {
  it('deriva identificadores de proyecto legibles', () => {
    expect(buildProjectIdentifier('Campaña Digital Verano')).toBe('CDV')
    expect(buildProjectIdentifier('Rebranding')).toBe('REBRA')
    expect(buildProjectIdentifier('')).toBe('PRJ')
    expect(buildProjectIdentifier('   ')).toBe('PRJ')
    expect(buildProjectIdentifier('Ñandú')).toBe('NANDU')
    expect(buildProjectIdentifier('A B C D E F').length).toBeLessThanOrEqual(5)
  })

  it('traduce estados y prioridades, con respaldo ante valores desconocidos', () => {
    expect(getStatusName(1)).toBe('Sin empezar')
    expect(getStatusName(5)).toBe('Completada')
    expect(getStatusName(99)).toBe('Sin empezar')
    expect(getPriorityName(4)).toBe('Urgent')
    expect(getPriorityName(0)).toBe('NoPriority')
  })
})

describe('descripción de la tarea', () => {
  const staff = new Map<number, PerfexStaff>([
    [1, { staffid: 1, email: 'a@x.com', firstname: 'Ana', lastname: 'Pérez', active: 1 }],
    [2, { staffid: 2, email: 'b@x.com', firstname: 'Beto', lastname: 'Ruiz', active: 1 }]
  ])

  const task = (description: string | null, assignees: number[]): PerfexTask =>
    ({
      id: 1,
      name: 'Tarea',
      description,
      priority: 2,
      status: 1,
      dateadded: new Date(),
      startdate: null,
      duedate: null,
      rel_id: null,
      rel_type: null,
      milestone: null,
      companyArea: [],
      assignees
    }) as unknown as PerfexTask

  it('convierte el HTML de Perfex a markdown', () => {
    expect(buildIssueDescription(task('<p>Hola <b>mundo</b></p>', [1]), staff)).toContain('mundo')
  })

  it('lista los asignados que Huly no puede representar', () => {
    const result = buildIssueDescription(task('<p>Texto</p>', [1, 2]), staff)
    expect(result).toContain('**Otros asignados en Perfex:** Beto Ruiz')
    expect(result).not.toContain('Ana Pérez')
  })

  it('no agrega la nota cuando hay un solo asignado', () => {
    expect(buildIssueDescription(task('<p>Texto</p>', [1]), staff)).not.toContain('Otros asignados')
  })

  it('tolera descripciones vacías', () => {
    expect(buildIssueDescription(task(null, []), staff)).toBe('')
  })
})

describe('campo de enlace de Perfex', () => {
  it('extrae la url del html que guarda Perfex', () => {
    expect(extractUrl('<a href="https://drive.google.com/x" target="_blank">https://drive.google.com/x</a>')).toBe(
      'https://drive.google.com/x'
    )
  })

  it('deja pasar una url pelada', () => {
    expect(extractUrl(' https://drive.google.com/y ')).toBe('https://drive.google.com/y')
  })

  it('cae al texto plano si no hay href', () => {
    expect(extractUrl('<span>sin link</span>')).toBe('sin link')
  })
})

describe('reparto en ambientes', () => {
  const mgc = getEnvironment('mgc')
  const wiwo = getEnvironment('wiwo')
  const sinClasificar = getEnvironment('sin-clasificar')

  it('manda cada grupo a su ambiente', () => {
    expect(belongsToEnvironment(['MGC HQ'], mgc)).toBe(true)
    expect(belongsToEnvironment(['Aima'], mgc)).toBe(true)
    expect(belongsToEnvironment(['WIWO'], mgc)).toBe(false)
    expect(belongsToEnvironment(['WIWO'], wiwo)).toBe(true)
  })

  it('tolera espacios y mayúsculas del nombre del grupo', () => {
    expect(belongsToEnvironment(['MGC HQ '], mgc)).toBe(true)
    expect(belongsToEnvironment(['wiwo'], wiwo)).toBe(true)
  })

  it('deja en sin clasificar a los clientes sin grupo o con grupos que nadie reclama', () => {
    expect(belongsToEnvironment([], sinClasificar)).toBe(true)
    expect(belongsToEnvironment(['Grupo nuevo'], sinClasificar)).toBe(true)
    expect(belongsToEnvironment(['MGC HQ'], sinClasificar)).toBe(false)
  })

  it('manda a un solo ambiente al cliente que está en dos grupos', () => {
    // Hay clientes en MGC HQ y WIWO a la vez: si entraran en los dos, sus proyectos se duplicarían.
    expect(belongsToEnvironment(['MGC HQ', 'WIWO'], wiwo)).toBe(true)
    expect(belongsToEnvironment(['MGC HQ', 'WIWO'], mgc)).toBe(false)
  })

  it('rechaza ambientes inexistentes', () => {
    expect(() => getEnvironment('otro')).toThrow()
  })
})
