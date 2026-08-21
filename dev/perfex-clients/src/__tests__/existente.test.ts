import { type Ref } from '@hcengineering/core'
import { type Issue, type Project } from '@hcengineering/tracker'

import { claveDeComentario, claveDeHito, normalizarNombre } from '../existente'

describe('normalizarNombre', () => {
  it('ignora mayúsculas y espacios de más', () => {
    expect(normalizarNombre('  EMSA   Chile ')).toBe('emsa chile')
    expect(normalizarNombre('Emsa Chile')).toBe(normalizarNombre('EMSA  chile'))
  })
})

describe('claveDeComentario', () => {
  it('separa dos comentarios de la misma tarea por su fecha', () => {
    const issue = 'issue-1' as Ref<Issue>
    expect(claveDeComentario(issue, 1000)).not.toBe(claveDeComentario(issue, 2000))
    expect(claveDeComentario(issue, 1000)).toBe(claveDeComentario(issue, 1000))
  })

  it('trata el comentario sin fecha como uno solo', () => {
    const issue = 'issue-1' as Ref<Issue>
    expect(claveDeComentario(issue, undefined)).toBe(`${issue}:0`)
  })
})

describe('claveDeHito', () => {
  it('reconoce el mismo hito aunque cambie el formato del nombre', () => {
    const project = 'proj-1' as Ref<Project>
    expect(claveDeHito(project, 'Etapa  1')).toBe(claveDeHito(project, 'etapa 1'))
  })

  it('distingue hitos de proyectos distintos', () => {
    expect(claveDeHito('proj-1' as Ref<Project>, 'Etapa 1')).not.toBe(
      claveDeHito('proj-2' as Ref<Project>, 'Etapa 1')
    )
  })
})
