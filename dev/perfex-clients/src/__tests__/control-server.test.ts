import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AccountRole, SocialIdType, type SocialId } from '@hcengineering/core'

import {
  authorizedEmail,
  createRunPlan,
  hasMaintainerRole,
  MigrationControlService,
  redactLog,
  type MigrationRun
} from '../control-server'
import type { SyncConfig } from '../sync'

const config: SyncConfig = {
  front: 'https://ops.example',
  permisosCsv: '/config/permisos.csv',
  workspaces: ['wiwo', 'palta', 'mgc', 'sin-clasificar'].map((env) => ({
    env,
    workspace: env,
    tokenEnv: `HULY_TOKEN_${env.toUpperCase()}`,
    owners: ['owner@example.com']
  }))
}

describe('centro de migración', () => {
  it('crea una matriz en orden y permite acotarla', () => {
    const run = createRunPlan(config, { environments: ['palta'], stages: ['preflight', 'clientes'], dryRun: true }, 'j@wiwo.me')

    expect(run.dryRun).toBe(true)
    expect(run.steps.map(({ id }) => id)).toEqual(['palta:preflight', 'palta:clientes'])
  })

  it('rechaza workspaces y etapas que no estén configurados', () => {
    expect(() => createRunPlan(config, { environments: ['otro'] }, 'j@wiwo.me')).toThrow('Workspaces inválidos')
    expect(() => createRunPlan(config, { stages: ['sql-libre'] }, 'j@wiwo.me')).toThrow('Etapas inválidas')
  })

  it('rechaza tipos inválidos recibidos por la API', () => {
    expect(() => createRunPlan(config, { environments: 'wiwo' } as unknown as { environments: string[] }, 'j@wiwo.me')).toThrow('lista de strings')
    expect(() => createRunPlan(config, { dryRun: 'sí' } as unknown as { dryRun: boolean }, 'j@wiwo.me')).toThrow('booleano')
  })

  it('redacta credenciales antes de persistir logs', () => {
    expect(redactLog('Authorization: Bearer abc.def token=secreto password:clave')).toBe(
      'Authorization: Bearer [REDACTED] token=[REDACTED] password:[REDACTED]'
    )
  })

  it('exige Maintainer y un correo verificado de la allowlist', () => {
    const allowed = new Set(['j@wiwo.me'])
    const socialIds = [
      { type: SocialIdType.EMAIL, value: 'otro@wiwo.me', verifiedOn: 1 },
      { type: SocialIdType.EMAIL, value: 'J@WIWO.ME', verifiedOn: 1 }
    ] as SocialId[]

    expect(hasMaintainerRole(AccountRole.User)).toBe(false)
    expect(hasMaintainerRole(AccountRole.Maintainer)).toBe(true)
    expect(hasMaintainerRole(AccountRole.Owner)).toBe(true)
    expect(authorizedEmail(socialIds, allowed)).toBe('j@wiwo.me')
    expect(authorizedEmail([{ ...socialIds[1], verifiedOn: undefined }], allowed)).toBeUndefined()
  })

  it('marca como fallida una etapa interrumpida por reinicio', () => {
    const dir = mkdtempSync(join(tmpdir(), 'perfex-control-'))
    const configPath = join(dir, 'sync.json')
    writeFileSync(configPath, JSON.stringify(config))
    const run: MigrationRun = {
      id: '10000000-0000-0000-0000-000000000000',
      createdAt: new Date().toISOString(),
      createdBy: 'j@wiwo.me',
      dryRun: false,
      status: 'running',
      lastSequence: 0,
      steps: [{
        id: 'wiwo:clientes',
        environment: 'wiwo',
        workspace: 'wiwo',
        stage: 'clientes',
        status: 'running'
      }]
    }
    writeFileSync(join(dir, `${run.id}.json`), JSON.stringify(run))

    const service = new MigrationControlService(configPath, dir, '/tmp/worker.js')

    const recovered = JSON.parse(readFileSync(join(dir, `${run.id}.json`), 'utf8')) as MigrationRun
    expect(service.listRuns()).toHaveLength(1)
    expect(recovered.status).toBe('failed')
    expect(recovered.steps[0].status).toBe('failed')
    expect(recovered.steps[0].error).toContain('reinició')
    rmSync(dir, { recursive: true })
  })
})
