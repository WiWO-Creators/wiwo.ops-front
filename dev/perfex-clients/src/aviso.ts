//
// Aviso de fin de corrida.
//
// Una migración larga se deja corriendo en segundo plano, así que tiene que poder avisar sola
// cuando termina. El aviso nunca hace fallar la migración: si el destino no responde, se anota
// y se sigue.
//
import { type Logger } from './import'

export interface RunResult {
  /** Ambiente migrado, para saber cuál de las corridas terminó. */
  environment: string
  ok: boolean
  /** Líneas de resumen: lo mismo que se ve en el registro. */
  summary: string[]
  /** Mensaje de error, si la corrida falló. */
  error?: string
}

/**
 * Manda el resultado a una URL por POST, en formato JSON.
 *
 * Sirve tal cual para un webhook de Slack o Discord —el campo `text` es lo que muestran— y para
 * n8n o cualquier servicio propio, que reciben el objeto completo.
 *
 * @param url destino del aviso. Si viene vacío, no se hace nada.
 */
export async function notifyResult (url: string | undefined, result: RunResult, logger: Logger): Promise<void> {
  if (url === undefined || url.trim() === '') return

  const estado = result.ok ? 'terminó bien' : 'FALLÓ'
  const text = [`Migración de Perfex a Huly (${result.environment}) ${estado}.`, ...result.summary]
    .concat(result.error !== undefined ? [`Error: ${result.error}`] : [])
    .join('\n')

  try {
    const response = await fetch(url.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...result }),
      signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) {
      logger.error(`El aviso de fin devolvió ${response.status}; la migración igual terminó`)
      return
    }
    logger.log('Aviso de fin enviado')
  } catch (err: any) {
    logger.error(`No se pudo enviar el aviso de fin: ${err.message}. La migración igual terminó`)
  }
}
