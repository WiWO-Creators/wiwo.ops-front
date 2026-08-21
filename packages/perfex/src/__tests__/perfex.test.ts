import { PerfexReader } from '../perfex'

describe('PerfexReader.getTimeEntries', () => {
  it('lee los campos del timer en un orden estable', async () => {
    const query = jest.fn().mockResolvedValue([[]])
    const reader = Object.create(PerfexReader.prototype) as PerfexReader
    Object.assign(reader as unknown as { connection: { query: typeof query }; prefix: string }, {
      connection: { query },
      prefix: 'tbl'
    })

    await reader.getTimeEntries()

    expect(query).toHaveBeenCalledWith(
      'SELECT id, task_id, start_time, end_time, staff_id, note FROM tbltaskstimers ORDER BY task_id, start_time, id'
    )
  })
})
