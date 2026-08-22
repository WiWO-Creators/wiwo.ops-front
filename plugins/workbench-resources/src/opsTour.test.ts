import type { Application } from '@hcengineering/workbench'
import { getOpsTourSteps, isOpsApplication } from './opsTour'

const app = (alias: string): Application => ({ alias, label: `label-${alias}`, position: 'mid' } as Application)

test('crea una demostración para cada funcionalidad de Ops', () => {
  const steps = getOpsTourSteps([app('tracker'), app('drive')])
  expect(steps.filter((step) => step.appAlias !== undefined)).toHaveLength(2)
  expect(steps.some((step) => step.action === 'openNewMenu')).toBe(true)
  expect(steps.some((step) => step.moduleLabel === 'label-drive')).toBe(true)
  expect(steps.filter((step) => step.surface === 'popup')).toHaveLength(6)
})

test('no considera navegación global como funcionalidad de Ops', () => {
  expect(isOpsApplication(app('home'))).toBe(false)
  expect(isOpsApplication(app('inbox'))).toBe(false)
  expect(isOpsApplication(app('tracker'))).toBe(true)
})
