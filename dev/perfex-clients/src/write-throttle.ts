import { type TxOperations } from '@hcengineering/core'

export const MIGRATION_CREATE_DELAY_MS = 1_000

const CREATION_METHODS = new Set<PropertyKey>(['addCollection', 'createDoc', 'createMixin'])

export type RunSequentialWrite = <T>(write: () => Promise<T>) => Promise<T>

/** Espera el intervalo indicado sin bloquear el proceso. */
export async function waitForWriteDrain (delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
}

/** Serializa escrituras y deja un intervalo completo después de cada operación terminada. */
export function createSequentialWriteRunner (
  delayMs: number,
  wait: (delayMs: number) => Promise<void> = waitForWriteDrain
): RunSequentialWrite {
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error('El intervalo entre escrituras debe ser válido')

  let tail = Promise.resolve()
  let completedWrite = false
  let failed = false
  let failure: unknown

  return <T>(write: () => Promise<T>): Promise<T> => {
    const current = tail.then(async () => {
      if (failed) throw failure
      if (completedWrite) await wait(delayMs)
      const result = await write()
      completedWrite = true
      return result
    })
    tail = current.then(
      () => undefined,
      (err: unknown) => {
        failed = true
        failure = err
      }
    )
    return current
  }
}

/** Encauza todas las operaciones que crean documentos por un único escritor secuencial. */
export function serializeCreateOperations (client: TxOperations, runWrite: RunSequentialWrite): TxOperations {
  return new Proxy(client, {
    get: (target, property) => {
      const value = Reflect.get(target, property, target)
      if (typeof value !== 'function') return value

      const bound = value.bind(target) as (...args: unknown[]) => unknown
      if (!CREATION_METHODS.has(property)) return bound

      return (...args: unknown[]) => runWrite(async () => await Promise.resolve(bound(...args)))
    }
  })
}
