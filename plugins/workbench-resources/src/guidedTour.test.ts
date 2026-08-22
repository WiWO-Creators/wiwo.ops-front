import { getGuidedTourPhase, getGuidedTourStep } from './guidedTourState'

test('reinicia el tutorial cuando el progreso guardado no es válido', () => {
  expect(getGuidedTourStep(8, 6)).toBe(0)
  expect(getGuidedTourStep(-1, 6)).toBe(0)
  expect(getGuidedTourStep(3, 6)).toBe(3)
})

test('muestra activación antes del recorrido y no reabre uno finalizado', () => {
  expect(getGuidedTourPhase(undefined, undefined, undefined)).toBe('activation')
  expect(getGuidedTourPhase(1, undefined, undefined)).toBe('tour')
  expect(getGuidedTourPhase(1, 2, undefined)).toBe('completed')
  expect(getGuidedTourPhase(1, undefined, 2)).toBe('skipped')
})
