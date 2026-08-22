import type { IntlString } from '@hcengineering/platform'
import { calendarId } from '@hcengineering/calendar'
import { loveId } from '@hcengineering/love'
import { trackerId } from '@hcengineering/tracker'
import type { Application } from '@hcengineering/workbench'

export type TourAction =
  | 'openApplication'
  | 'openNewMenu'
  | 'openIssueForm'
  | 'openBoard'
  | 'openCalendarEventForm'
  | 'openTeleworkRoom'
  | 'openTeleworkConfigure'
  | 'openTeleworkAddRoom'
export type TourSurface = 'page' | 'popup'
export type TourCardAction = 'start' | 'next' | 'previous' | 'retry' | 'skip' | 'skipTour'

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
const guidedTourAliases = new Set<string>([trackerId, calendarId, loveId])

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

const calendarSteps: Omit<TourStep, 'moduleLabel'>[] = [
  { title: 'Elige una vista', description: 'Cambia entre las vistas disponibles para organizar tus eventos según el horizonte que necesites revisar.', selector: '[data-tutorial="calendar-view-selector"]' },
  { title: 'Navega por las fechas', description: 'Usa Hoy y las flechas para volver al periodo actual o recorrer el calendario.', selector: '[data-tutorial="calendar-navigation"]' },
  { title: 'Crea un evento', description: 'Este es el formulario real de eventos. La guía lo abre como demostración y no guardará nada.', selector: '[data-tutorial="calendar-event-title"]', action: 'openCalendarEventForm', surface: 'popup' },
  { title: 'Define fecha y duración', description: 'Indica cuándo ocurre el evento, su duración y, si hace falta, repeticiones o todo el día.', selector: '[data-tutorial="calendar-event-time"]', surface: 'popup' },
  { title: 'Agrega lugar y participantes', description: 'Incluye ubicación, personas internas o invitadas externas para coordinar el evento.', selector: '[data-tutorial="calendar-event-participants"]', surface: 'popup' },
  { title: 'Entrega contexto', description: 'Usa la descripción para anotar agenda, enlaces y la información necesaria para la reunión.', selector: '[data-tutorial="calendar-event-description"]', surface: 'popup' },
  { title: 'Elige calendario y visibilidad', description: 'Selecciona el calendario de destino y controla quién puede ver el evento.', selector: '[data-tutorial="calendar-event-calendar"]', surface: 'popup' },
  { title: 'Configura recordatorios', description: 'Añade o ajusta recordatorios antes de crear el evento.', selector: '[data-tutorial="calendar-event-reminders"]', surface: 'popup' }
]

const teleworkSteps: Omit<TourStep, 'moduleLabel'>[] = [
  { title: 'Elige un piso', description: 'Cambia entre los pisos o espacios disponibles de Teletrabajo.', selector: '[data-tutorial="telework-floor-selector"]' },
  { title: 'Explora las salas', description: 'Esta vista muestra las salas y quién está disponible en cada una.', selector: '[data-tutorial="telework-rooms"]' },
  { title: 'Abre una sala', description: 'Selecciona una sala para ver sus detalles antes de ingresar.', selector: '[data-tutorial="telework-room-detail"]', action: 'openTeleworkRoom' },
  { title: 'Ingresa a la reunión', description: 'Desde esta ficha puedes iniciar o unirte a una reunión. La guía bloquea el botón: no te conectará.', selector: '[data-tutorial="telework-enter-room"]' }
]

const teleworkManagementSteps: Omit<TourStep, 'moduleLabel'>[] = [
  { title: 'Administra las salas', description: 'Las cuentas con permiso de mantenimiento pueden editar el plano y la disposición de las salas.', selector: '[data-tutorial="telework-edit-office"]', action: 'openTeleworkConfigure' },
  { title: 'Añade una sala o piso', description: 'Aquí se elige el tipo de sala o se agrega un piso. Es una demostración: no se creará nada.', selector: '[data-tutorial="telework-room-types"]', action: 'openTeleworkAddRoom', surface: 'popup' }
]

/** Returns applications that are functional areas of Ops rather than global navigation. */
export function isOpsApplication (app: Application): boolean {
  return !excludedAliases.has(app.alias)
}

/** Returns the three Ops areas currently covered by the guided tutorial. */
export function isGuidedTourApplication (app: Application): boolean {
  return guidedTourAliases.has(app.alias)
}

/** Builds a no-write walkthrough for Seguimiento, Calendario and Teletrabajo. */
export function getOpsTourSteps (apps: Application[], canManageTelework = false): TourStep[] {
  return apps.filter(isGuidedTourApplication).flatMap((app) => {
    const entry: TourStep = {
      title: 'Funcionalidad de Ops',
      description: 'La guía abre esta funcionalidad y muestra su recorrido principal sin crear datos.',
      selector: `[data-id="app-sidebar-${app.alias}"]`,
      moduleLabel: app.label,
      action: 'openApplication',
      appAlias: app.alias
    }
    const moduleSteps = app.alias === trackerId
      ? trackerSteps
      : app.alias === calendarId
        ? calendarSteps
        : app.alias === loveId
          ? [...teleworkSteps, ...(canManageTelework ? teleworkManagementSteps : [])]
          : []
    return [entry, ...moduleSteps.map((step) => ({ ...step, moduleLabel: app.label }))]
  })
}
