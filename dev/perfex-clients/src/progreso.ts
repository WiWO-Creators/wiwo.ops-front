/**
 * Formatea avance acotado de una etapa, incluyendo un total cero.
 *
 * @param current elementos ya procesados.
 * @param total objetivo total de la etapa.
 * @returns texto listo para la consola.
 */
export function formatProgress (current: number, total: number): string {
  const percent = total === 0 ? 100 : Math.floor((current / total) * 100)
  return `${current}/${total} (${percent}%)`
}
