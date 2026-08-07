//
// Copyright © 2025 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { type AnalyticProvider, Analytics } from '@hcengineering/analytics'
import { type AnalyticsConfig } from './types'

export * from './analyticsCollector'
export * from './utils'
export * from './types'

/**
 * Registra los proveedores de analítica del cliente.
 *
 * Este fork no envía telemetría a ningún colector externo, por lo que la lista
 * de proveedores queda vacía y los eventos de Analytics no salen del navegador.
 *
 * @param config configuración de analítica cargada desde el servidor
 */
export function configureAnalyticsProviders (config: AnalyticsConfig): void {
  const providers: AnalyticProvider[] = []

  for (const provider of providers) {
    Analytics.init(provider, config)
  }
}
