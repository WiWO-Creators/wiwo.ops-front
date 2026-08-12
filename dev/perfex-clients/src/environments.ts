//
// Reparto de los clientes de Perfex en los ambientes de Huly.
//
// Cada ambiente es un workspace aparte y se decide por el grupo de cliente de Perfex.
//

export interface Environment {
  /** Clave que se pasa por línea de comandos. */
  id: string
  /** Nombre legible, sólo para los mensajes. */
  label: string
  /** Grupos de cliente de Perfex que pertenecen a este ambiente. */
  groups: string[]
}

/**
 * El orden importa: hay clientes que están en dos grupos a la vez (por ejemplo MGC HQ y WIWO) y
 * cada cliente tiene que ir a un solo ambiente. Gana el primero de esta lista, que va del grupo
 * más específico al más general. El último, sin grupos, recoge todo lo demás.
 */
export const ENVIRONMENTS: Environment[] = [
  { id: 'wiwo', label: 'WiWO', groups: ['WIWO'] },
  { id: 'palta', label: 'Palta', groups: ['Palta'] },
  {
    id: 'mgc',
    label: 'MGC',
    groups: ['MGC HQ', 'MGC Andina', 'MGC Caribe', 'MGC USA', 'Aima', 'Foundaxis', 'HL', 'iLuk']
  },
  { id: 'sin-clasificar', label: 'Sin clasificar', groups: [] }
]

export function getEnvironment (id: string): Environment {
  const environment = ENVIRONMENTS.find((e) => e.id === id)
  if (environment === undefined) {
    throw new Error(`Ambiente desconocido: ${id}. Válidos: ${ENVIRONMENTS.map((e) => e.id).join(', ')}`)
  }
  return environment
}

/**
 * Devuelve el único ambiente al que va un cliente, según sus grupos de Perfex.
 *
 * Los clientes sin grupo, o con grupos que ningún ambiente reclama, caen en `sin-clasificar`,
 * para que ninguno quede afuera de la migración.
 */
export function resolveEnvironment (clientGroups: string[]): Environment {
  const groups = clientGroups.map((g) => g.trim().toLowerCase()).filter((g) => g !== '')
  const match = ENVIRONMENTS.find(
    (e) => e.groups.length > 0 && e.groups.some((own) => groups.includes(own.toLowerCase()))
  )
  return match ?? ENVIRONMENTS[ENVIRONMENTS.length - 1]
}

/** Decide si un cliente pertenece al ambiente indicado. */
export function belongsToEnvironment (clientGroups: string[], environment: Environment): boolean {
  return resolveEnvironment(clientGroups).id === environment.id
}
