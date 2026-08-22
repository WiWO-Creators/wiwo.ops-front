export type GuidedTourPhase = 'activation' | 'tour' | 'completed'

/** Converts stored progress into a valid tour step. */
export function getGuidedTourStep (step: number | undefined, stepsCount: number): number {
  return step !== undefined && step >= 0 && step < stepsCount ? step : 0
}

/** Resolves the only phase a user can enter from persisted tutorial data. */
export function getGuidedTourPhase (activatedOn: number | undefined, completedOn: number | undefined): GuidedTourPhase {
  if (completedOn !== undefined) return 'completed'
  return activatedOn === undefined ? 'activation' : 'tour'
}
