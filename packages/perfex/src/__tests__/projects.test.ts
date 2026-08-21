import { PerfexReader } from '../perfex'

describe('PerfexReader.getProjects', () => {
  it('conserva la cotización y palabra clave de los campos de proyecto', async () => {
    const projects = [{ id: 7, name: 'Campaña' }]
    const query = jest.fn().mockResolvedValueOnce([projects]).mockResolvedValueOnce([[
      { relid: 7, fieldid: 4, value: '00000' },
      { relid: 7, fieldid: 8, value: 'Posicionamiento' }
    ]])
    const reader = Object.create(PerfexReader.prototype) as PerfexReader
    Object.assign(reader as unknown as { connection: { query: typeof query }, prefix: string }, {
      connection: { query },
      prefix: 'tbl'
    })

    const result = await reader.getProjects()

    expect(result[0]).toMatchObject({ numeroCotizacion: '00000', palabraClave: 'Posicionamiento' })
    expect(query).toHaveBeenLastCalledWith(
      "SELECT relid, fieldid, value\n       FROM tblcustomfieldsvalues\n       WHERE fieldto = 'projects' AND fieldid IN (4, 8) AND value <> ''"
    )
  })
})
