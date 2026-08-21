import { getGuidedTourStep } from './guidedTourState'

test('reinicia el tutorial cuando el progreso guardado no es válido', () => {
  expect(getGuidedTourStep(8, 6)).toBe(0)
  expect(getGuidedTourStep(-1, 6)).toBe(0)
  expect(getGuidedTourStep(3, 6)).toBe(3)
})
