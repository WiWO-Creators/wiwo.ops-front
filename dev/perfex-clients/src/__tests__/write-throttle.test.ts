import { createSequentialWriteRunner, serializeCreateOperations } from '../write-throttle'

describe('cola de escrituras de migración', () => {
  it('rechaza intervalos inválidos', () => {
    expect(() => createSequentialWriteRunner(-1)).toThrow('intervalo entre escrituras')
    expect(() => createSequentialWriteRunner(Number.NaN)).toThrow('intervalo entre escrituras')
  })

  it('ejecuta una creación a la vez y espera un segundo entre ellas', async () => {
    const waits: number[] = []
    const runWrite = createSequentialWriteRunner(1_000, async (delayMs) => {
      waits.push(delayMs)
    })
    let activeWrites = 0
    let maximumActiveWrites = 0
    const write = async (): Promise<void> => {
      activeWrites++
      maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites)
      await Promise.resolve()
      activeWrites--
    }

    await Promise.all([runWrite(write), runWrite(write), runWrite(write)])

    expect(maximumActiveWrites).toBe(1)
    expect(waits).toEqual([1_000, 1_000])
  })

  it('no ejecuta escrituras encoladas después del primer error', async () => {
    const error = new Error('falló el transactor')
    const runWrite = createSequentialWriteRunner(1_000, async () => {})
    const first = runWrite(async () => await Promise.reject(error))
    const secondWrite = jest.fn(async () => {})
    const second = runWrite(secondWrite)

    await expect(first).rejects.toBe(error)
    await expect(second).rejects.toBe(error)
    expect(secondWrite).not.toHaveBeenCalled()
  })

  it('encauza todos los métodos de creación y deja libres las lecturas', async () => {
    const rawClient = {
      addCollection: jest.fn(async () => 'collection'),
      createDoc: jest.fn(async () => 'document'),
      createMixin: jest.fn(async () => undefined),
      findAll: jest.fn(async () => [])
    }
    const runWrite = jest.fn(async (write: () => Promise<unknown>) => await write())
    const client = serializeCreateOperations(rawClient as never, runWrite) as unknown as typeof rawClient

    await client.addCollection()
    await client.createDoc()
    await client.createMixin()
    await client.findAll()

    expect(runWrite).toHaveBeenCalledTimes(3)
    expect(rawClient.findAll).toHaveBeenCalledTimes(1)
  })
})
