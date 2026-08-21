import { planificarLimpiezaDeTipos, type TipoConUso } from '..'

function tipo (over: Partial<TipoConUso> = {}): TipoConUso {
  return { id: 'a' as any, name: 'Perfex', createdOn: 1, projects: 0, ...over }
}

describe('planificarLimpiezaDeTipos', () => {
  it('conserva el tipo con proyectos y borra los repetidos vacíos', () => {
    const tipos = [
      tipo({ id: 'a' as any, createdOn: 1 }),
      tipo({ id: 'b' as any, createdOn: 2, projects: 12 }),
      tipo({ id: 'c' as any, createdOn: 3 }),
      tipo({ id: 'd' as any, createdOn: 4 })
    ]
    const { borrar, enUso } = planificarLimpiezaDeTipos(tipos)
    expect(borrar.map((t) => t.id)).toEqual(['a', 'c', 'd'])
    expect(enUso).toHaveLength(0)
  })

  it('no toca los tipos con nombre único', () => {
    const tipos = [tipo({ id: 'a' as any, name: 'Classic project' }), tipo({ id: 'b' as any })]
    expect(planificarLimpiezaDeTipos(tipos).borrar).toHaveLength(0)
  })

  it('informa, sin borrar, los repetidos que sí tienen proyectos', () => {
    const tipos = [
      tipo({ id: 'a' as any, createdOn: 1, projects: 5 }),
      tipo({ id: 'b' as any, createdOn: 2, projects: 3 })
    ]
    const { borrar, enUso } = planificarLimpiezaDeTipos(tipos)
    expect(borrar).toHaveLength(0)
    expect(enUso.map((t) => t.id)).toEqual(['b'])
  })

  it('a igualdad de proyectos conserva el más viejo', () => {
    const tipos = [tipo({ id: 'nuevo' as any, createdOn: 9 }), tipo({ id: 'viejo' as any, createdOn: 1 })]
    expect(planificarLimpiezaDeTipos(tipos).borrar.map((t) => t.id)).toEqual(['nuevo'])
  })
})
