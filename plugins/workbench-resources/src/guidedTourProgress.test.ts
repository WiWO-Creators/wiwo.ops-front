import {
  getGuidedTourStorageKey,
  readGuidedTourProgress,
  writeGuidedTourProgress,
  type GuidedTourLocalProgress
} from './guidedTourProgress'

function memoryStorage (): { getItem: (key: string) => string | null, setItem: (key: string, value: string) => void } {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('guarda y recupera progreso local válido por cuenta y workspace', () => {
  const storage = memoryStorage()
  const key = getGuidedTourStorageKey('sanity/ws', 'account:1')
  const progress: GuidedTourLocalProgress = {
    currentStep: 3,
    activatedOn: 10,
    pendingSync: true,
    updatedOn: 20
  }

  writeGuidedTourProgress(storage, key, progress)

  expect(key).toBe('guided-tour-v1:sanity%2Fws:account%3A1')
  expect(readGuidedTourProgress(storage, key, 6)).toEqual(progress)
})

test('descarta JSON corrupto y pasos fuera del recorrido', () => {
  const corrupt = { getItem: (): string => '{', setItem: (): void => {} }
  const invalidStep = {
    getItem: (): string => '{"currentStep":9,"pendingSync":true,"updatedOn":1}',
    setItem: (): void => {}
  }

  expect(readGuidedTourProgress(corrupt, 'key', 6)).toBeUndefined()
  expect(readGuidedTourProgress(invalidStep, 'key', 6)).toBeUndefined()
})

test('no bloquea el recorrido cuando el almacenamiento no está disponible', () => {
  const unavailable = {
    getItem: (): string | null => {
      throw new Error('blocked')
    },
    setItem: (): void => {
      throw new Error('blocked')
    }
  }
  const progress: GuidedTourLocalProgress = { currentStep: 0, pendingSync: true, updatedOn: 1 }

  expect(readGuidedTourProgress(unavailable, 'key', 3)).toBeUndefined()
  expect(() => { writeGuidedTourProgress(unavailable, 'key', progress) }).not.toThrow()
  expect(readGuidedTourProgress(undefined, 'key', 3)).toBeUndefined()
})
