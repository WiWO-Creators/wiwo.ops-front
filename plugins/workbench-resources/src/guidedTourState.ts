/** Converts stored progress into a valid tour step. */
export function getGuidedTourStep (step: number | undefined, stepsCount: number): number {
  return step !== undefined && step >= 0 && step < stepsCount ? step : 0
}
