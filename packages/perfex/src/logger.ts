/** Registro de la corrida: la consola en el comando, el log del transactor en el deploy. */
export interface Logger {
  log: (msg: string) => void
  error: (msg: string) => void
}
