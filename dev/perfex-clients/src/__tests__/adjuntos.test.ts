import { type PerfexFile } from '@hcengineering/perfex'

import { rutaDeArchivo, tipoDeArchivo } from '../adjuntos'

function archivo (over: Partial<PerfexFile> = {}): PerfexFile {
  return {
    id: 1,
    rel_id: 44,
    rel_type: 'task',
    file_name: 'propuesta.pdf',
    filetype: 'application/pdf',
    task_comment_id: 0,
    dateadded: new Date('2026-07-08T12:06:14'),
    ...over
  }
}

describe('rutaDeArchivo', () => {
  it('usa la carpeta que le toca a cada tipo de objeto', () => {
    expect(rutaDeArchivo('/rescate', archivo())).toBe('/rescate/tasks/44/propuesta.pdf')
    expect(rutaDeArchivo('/rescate', archivo({ rel_type: 'contract', rel_id: 7 }))).toBe(
      '/rescate/contracts/7/propuesta.pdf'
    )
    expect(rutaDeArchivo('/rescate', archivo({ rel_type: 'customer', rel_id: 13 }))).toBe(
      '/rescate/clients/13/propuesta.pdf'
    )
  })

  it('deja el adjunto de comentario en la carpeta de la tarea', () => {
    expect(rutaDeArchivo('/rescate', archivo({ task_comment_id: 214 }))).toBe('/rescate/tasks/44/propuesta.pdf')
  })
})

describe('tipoDeArchivo', () => {
  it('respeta el tipo que declara el board cuando está entero', () => {
    expect(tipoDeArchivo(archivo({ filetype: 'image/png', file_name: 'captura.png' }))).toBe('image/png')
  })

  it('reemplaza el tipo truncado por el de la extensión', () => {
    // `tblfiles.filetype` es varchar(40) y corta los MIME de Office a media palabra.
    const truncado = archivo({
      file_name: 'Contrato.docx',
      filetype: 'application/vnd.openxmlformats-officedoc'
    })
    expect(tipoDeArchivo(truncado)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('cae en la extensión cuando el board no declara tipo', () => {
    expect(tipoDeArchivo(archivo({ filetype: null, file_name: 'foto.JPEG' }))).toBe('image/jpeg')
    expect(tipoDeArchivo(archivo({ filetype: '', file_name: 'foto.jpg' }))).toBe('image/jpeg')
  })

  it('usa el tipo genérico con una extensión desconocida o sin extensión', () => {
    expect(tipoDeArchivo(archivo({ filetype: null, file_name: 'respaldo.xyz' }))).toBe('application/octet-stream')
    expect(tipoDeArchivo(archivo({ filetype: null, file_name: 'LEEME' }))).toBe('application/octet-stream')
  })
})
