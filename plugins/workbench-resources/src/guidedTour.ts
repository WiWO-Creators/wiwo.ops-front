import { writable } from 'svelte/store'

export const guidedTourStarts = writable(0)

/** Opens the tour from the beginning, including after it was previously completed. */
export function startGuidedTour (): void {
  guidedTourStarts.update((value) => value + 1)
}
