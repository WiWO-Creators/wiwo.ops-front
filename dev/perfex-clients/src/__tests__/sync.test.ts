import { duplicadosSinResolver, idsParaArchivar, readSyncConfig } from '../sync'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('sync', () => {
  it('deja archivar sólo ids ausentes del dump', () => {
    expect(idsParaArchivar([1, 2, undefined, 4], new Set([1, 3]))).toEqual([2, 4])
  })

  it('bloquea un duplicado sin canónico y acepta uno válido', () => {
    const duplicado = { tipo: 'organizaciones' as const, clave: 'acme', ids: ['a', 'b'] }
    expect(duplicadosSinResolver([duplicado], {})).toEqual([duplicado])
    expect(duplicadosSinResolver([duplicado], { organizaciones: { acme: 'b' } })).toEqual([])
  })

  it('exige CSV M08 antes de validar los destinos', () => {
    const path = join(tmpdir(), `perfex-sync-${Date.now()}.json`)
    writeFileSync(path, JSON.stringify({ front: 'https://ops.example', workspaces: [] }))
    expect(() => readSyncConfig(path)).toThrow('permisosCsv')
    unlinkSync(path)
  })

  it('exige CSV y owners para ejecutar M08', () => {
    const path = join(tmpdir(), `perfex-sync-${Date.now()}.json`)
    const workspaces = ['wiwo', 'palta', 'mgc', 'sin-clasificar'].map((env) => ({
      env,
      workspace: env,
      tokenEnv: `HULY_TOKEN_${env}`,
      owners: []
    }))
    writeFileSync(path, JSON.stringify({ front: 'https://ops.example', permisosCsv: 'permisos.csv', workspaces }))
    expect(() => readSyncConfig(path)).toThrow('owners')
    unlinkSync(path)
  })
})
