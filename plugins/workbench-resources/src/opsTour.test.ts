import type { Application } from '@hcengineering/workbench'
import { getOpsTourSteps, isGuidedTourApplication, isOpsApplication } from './opsTour'

const app = (alias: string): Application => {
  const application: Application = { alias, label: `label-${alias}`, position: 'mid' }
  return application
}

test('crea demostraciones solo para las tres funcionalidades guiadas', () => {
  const steps = getOpsTourSteps([app('tracker'), app('calendar'), app('love'), app('drive')])
  expect(steps.filter((step) => step.appAlias !== undefined)).toHaveLength(3)
  expect(steps.some((step) => step.action === 'openNewMenu')).toBe(true)
  expect(steps.some((step) => step.action === 'openCalendarEventForm')).toBe(true)
  expect(steps.some((step) => step.action === 'openTeleworkRoom')).toBe(true)
  expect(steps.some((step) => step.action === 'openTeleworkConfigure')).toBe(false)
  expect(steps.filter((step) => step.surface === 'popup')).toHaveLength(12)
})

test('agrega administración de Teletrabajo solo a mantenedores', () => {
  const steps = getOpsTourSteps([app('love')], true)
  expect(steps.some((step) => step.action === 'openTeleworkConfigure')).toBe(true)
  expect(steps.some((step) => step.action === 'openTeleworkAddRoom')).toBe(true)
})

test.each(['tracker', 'calendar', 'love'])('cada paso de %s tiene una demostración real del módulo', (alias) => {
  const steps = getOpsTourSteps([app(alias)], true)

  expect(steps.every((step) => step.demo.length > 0)).toBe(true)
  expect(new Set(steps.map((step) => step.demoComponent))).toEqual(new Set([`${alias}:component:GuidedTourDemo`]))
})

test('no considera navegación global como funcionalidad de Ops', () => {
  expect(isOpsApplication(app('home'))).toBe(false)
  expect(isOpsApplication(app('inbox'))).toBe(false)
  expect(isOpsApplication(app('tracker'))).toBe(true)
  expect(isGuidedTourApplication(app('tracker'))).toBe(true)
  expect(isGuidedTourApplication(app('calendar'))).toBe(true)
  expect(isGuidedTourApplication(app('love'))).toBe(true)
  expect(isGuidedTourApplication(app('drive'))).toBe(false)
})
