import { PerfexReader } from '../perfex'

describe('PerfexReader.getTimeEntries', () => {
  it('lee los campos del timer en un orden estable', async () => {
    const query = jest.fn().mockResolvedValue([[]])
    const reader = Object.create(PerfexReader.prototype) as PerfexReader
    Object.assign(reader as unknown as { connection: { query: typeof query }, prefix: string }, {
      connection: { query },
      prefix: 'tbl'
    })

    await reader.getTimeEntries()

    expect(query).toHaveBeenCalledWith(
      'SELECT id, task_id, start_time, end_time, staff_id, note FROM tbltaskstimers ORDER BY task_id, start_time, id'
    )
  })

  it('informa la tabla, el inicio y el resultado de cada consulta', async () => {
    const query = jest.fn().mockResolvedValue([[{ id: 1 }]])
    const onQuery = jest.fn()
    const reader = Object.create(PerfexReader.prototype) as PerfexReader
    Object.assign(reader as unknown as Record<string, unknown>, {
      connection: { query },
      prefix: 'tbl',
      onQuery
    })

    await reader.getTimeEntries()

    expect(onQuery).toHaveBeenNthCalledWith(1, { phase: 'start', tables: ['tbltaskstimers'] })
    expect(onQuery).toHaveBeenNthCalledWith(2, { phase: 'finish', tables: ['tbltaskstimers'], rows: 1 })
  })

  it('informa el error de lectura antes de propagarlo', async () => {
    const query = jest.fn().mockRejectedValue(new Error('database offline'))
    const onQuery = jest.fn()
    const reader = Object.create(PerfexReader.prototype) as PerfexReader
    Object.assign(reader as unknown as Record<string, unknown>, {
      connection: { query },
      prefix: 'tbl',
      onQuery
    })

    await expect(reader.getTimeEntries()).rejects.toThrow('database offline')
    expect(onQuery).toHaveBeenLastCalledWith({
      phase: 'error',
      tables: ['tbltaskstimers'],
      error: 'database offline'
    })
  })
})
