export interface GuidedTourLocalProgress {
  currentStep: number
  activatedOn?: number
  completedOn?: number
  skippedOn?: number
  pendingSync: boolean
  updatedOn: number
}

interface StorageAccess {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

/** Builds the account-scoped key used to resume a tour without network access. */
export function getGuidedTourStorageKey (workspace: string, account: string): string {
  return `guided-tour-v1:${encodeURIComponent(workspace)}:${encodeURIComponent(account)}`
}

/** Reads and validates locally persisted progress, discarding corrupt or stale step values. */
export function readGuidedTourProgress (
  storage: StorageAccess | undefined,
  key: string,
  stepsCount: number
): GuidedTourLocalProgress | undefined {
  if (storage === undefined) return
  try {
    const raw = storage.getItem(key)
    if (raw === null) return
    const value = JSON.parse(raw) as Partial<GuidedTourLocalProgress>
    if (
      !Number.isInteger(value.currentStep) ||
      value.currentStep === undefined ||
      value.currentStep < 0 ||
      value.currentStep >= stepsCount ||
      typeof value.pendingSync !== 'boolean' ||
      typeof value.updatedOn !== 'number' ||
      !Number.isFinite(value.updatedOn)
    ) { return }
    return {
      currentStep: value.currentStep,
      activatedOn: validTimestamp(value.activatedOn),
      completedOn: validTimestamp(value.completedOn),
      skippedOn: validTimestamp(value.skippedOn),
      pendingSync: value.pendingSync,
      updatedOn: value.updatedOn
    }
  } catch {
    return undefined
  }
}

/** Persists progress synchronously so navigation never depends on backend availability. */
export function writeGuidedTourProgress (
  storage: StorageAccess | undefined,
  key: string,
  progress: GuidedTourLocalProgress
): boolean {
  if (storage === undefined) return false
  try {
    storage.setItem(key, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

function validTimestamp (value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}
