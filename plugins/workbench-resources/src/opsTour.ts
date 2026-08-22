import type { IntlString } from '@hcengineering/platform'
import { trackerId } from '@hcengineering/tracker'
import type { Application } from '@hcengineering/workbench'

export type TourAction = 'openApplication' | 'openNewMenu' | 'openIssueForm' | 'openBoard'
export type TourSurface = 'page' | 'popup'
export type TourCardAction = 'start' | 'next' | 'previous' | 'retry' | 'skip'

export interface TourStep {
  title: string
  description: string
  selector: string
  moduleLabel?: IntlString
  action?: TourAction
  appAlias?: string
  surface?: TourSurface
}

const excludedAliases = new Set(['home', 'inbox', 'notification'])

const trackerSteps: Omit<TourStep, 'moduleLabel'>[] = [
  { title: 'Crea o abre un proyecto', description: 'Este botón reúne las acciones para empezar. Elige Crear proyecto cuando necesites un espacio nuevo.', selector: '[data-tutorial="tracker-new-item"]' },
  { title: 'Revisa las opciones', description: 'El menú muestra crear proyecto, crear proceso e importar. La guía lo abre sin ejecutar ninguna acción.', selector: '[data-tutorial="tracker-new-item"]', action: 'openNewMenu' },
  { title: 'Crea un proceso', description: 'Así se ve el formulario. Es una simulación: no crea ni guarda un proceso.', selector: '#issue-name', action: 'openIssueForm', surface: 'popup' },
  { title: 'Elige el proyecto', description: 'Todo proceso pertenece a un proyecto. Selecciónalo aquí antes de guardarlo.', selector: '[data-tutorial="issue-project"]', surface: 'popup' },
  { title: 'Define el trabajo', description: 'Escribe un título claro y agrega el contexto necesario en la descripción.', selector: '#issue-description', surface: 'popup' },
  { title: 'Ordena la prioridad', description: 'Estado y prioridad indican qué hacer primero y en qué etapa está el proceso.', selector: '#status-editor', surface: 'popup' },
  { title: 'Asigna responsable', description: 'Indica quién es responsable. Puedes sumar etiquetas, componente, hito y fechas en esta misma ficha.', selector: '#assignee-editor', surface: 'popup' },
  { title: 'Divide el trabajo', description: 'Agrega subtareas para convertir el proceso en acciones concretas antes de guardarlo.', selector: '[data-tutorial="issue-subissues"]', surface: 'popup' },
  { title: 'Mira el tablero', description: 'El selector de vista permite cambiar a Tablero para seguir el avance por estado.', selector: '[data-tutorial="viewlet-selector"]', action: 'openBoard' }
]

/** Returns applications that are functional areas of Ops rather than global navigation. */
export function isOpsApplication (app: Application): boolean {
  return !excludedAliases.has(app.alias)
}

/** Builds a no-write demonstration for every enabled Ops functionality. */
export function getOpsTourSteps (apps: Application[]): TourStep[] {
  return apps.flatMap((app) => {
    const entry: TourStep = {
      title: 'Funcionalidad de Ops',
      description: 'La guía abre esta funcionalidad y muestra su recorrido principal sin crear datos.',
      selector: `[data-id="app-sidebar-${app.alias}"]`,
      moduleLabel: app.label,
      action: 'openApplication',
      appAlias: app.alias
    }
    if (app.alias !== trackerId) {
      return [entry, { title: 'Área principal', description: 'Aquí encuentras el contenido y las acciones principales de esta funcionalidad de Ops.', selector: '[data-id="contentPanel"]', moduleLabel: app.label }]
    }
    return [entry, ...trackerSteps.map((step) => ({ ...step, moduleLabel: app.label }))]
  })
}
