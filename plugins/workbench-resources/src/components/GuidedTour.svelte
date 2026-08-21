<script lang="ts">
  import core, { getCurrentAccount, type Class, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { location } from '@hcengineering/ui'
  import workbench from '@hcengineering/workbench'
  import type { GuidedTourPreference } from '@hcengineering/workbench/src/types'
  import { onDestroy, tick } from 'svelte'
  import { guidedTourStarts } from '../guidedTour'
  import { getGuidedTourStep } from '../guidedTourState'

  interface TourStep {
    title: string
    description: string
    selector: string
    advanceOnTargetClick?: boolean
  }

  const steps: TourStep[] = [
    { title: 'Abre Seguimiento', description: 'Haz clic en Seguimiento en la barra lateral. Ahí se organizan los proyectos y procesos.', selector: '[data-id="app-sidebar-tracker"]', advanceOnTargetClick: true },
    { title: 'Crea o abre un proyecto', description: 'Usa este botón para crear un proyecto si aún no existe uno, o abre el proyecto donde trabajarás.', selector: '[data-tutorial="tracker-new-item"]' },
    { title: 'Crea un proceso', description: 'Desde el mismo botón, elige Nuevo proceso. Escribe un título y completa lo necesario.', selector: '[data-tutorial="tracker-new-item"]', advanceOnTargetClick: true },
    { title: 'Asigna responsable', description: 'En la ficha del proceso, selecciona a la persona responsable. Agrega colaboradores si deben participar.', selector: '#assignee-editor' },
    { title: 'Divide el trabajo', description: 'Agrega subtareas para separar el proceso en acciones concretas antes de guardarlo.', selector: '[data-tutorial="issue-subissues"]' },
    { title: 'Mira el tablero', description: 'Abre este selector y elige Tablero para ordenar los procesos por estado y moverlos al avanzar.', selector: '[data-tutorial="viewlet-selector"]' }
  ]

  const account = getCurrentAccount()
  const client = getClient()
  const preferenceQuery = createQuery()
  const guidedTourPreferenceClass = (workbench.class as typeof workbench.class & {
    GuidedTourPreference: Ref<Class<GuidedTourPreference>>
  }).GuidedTourPreference
  let active = false
  let stepIndex = 0
  let preferenceId: Ref<GuidedTourPreference> | undefined
  let createPreferencePromise: Promise<Ref<GuidedTourPreference>> | undefined
  let hasCheckedInitialState = false
  let saving = false
  let saveError: string | undefined
  let target: HTMLElement | undefined
  let nextButton: HTMLButtonElement | undefined
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let spotlight = { top: 0, left: 0, width: 0, height: 0 }

  const unsubscribeTour = guidedTourStarts.subscribe((started) => {
    if (started !== 0) openTour(0)
  })
  const unsubscribeLocation = location.subscribe(() => {
    if (active) void updateTarget()
  })

  preferenceQuery.query(guidedTourPreferenceClass, { space: core.space.Workspace, attachedTo: account.uuid }, (records) => {
    const preference = records[0]
    preferenceId = preference?._id
    if (hasCheckedInitialState) return
    hasCheckedInitialState = true
    if (preference?.completedOn !== undefined) return
    void ensurePreference(preference?.currentStep ?? 0).catch(() => {
      saveError = 'No pudimos crear el registro del tutorial. Revisa tu conexión e inténtalo otra vez.'
    })
    openTour(getGuidedTourStep(preference?.currentStep, steps.length))
  }, { limit: 1 })

  /** Opens the mandatory tour from a persisted or explicit step. */
  function openTour (step: number): void {
    active = true
    stepIndex = getGuidedTourStep(step, steps.length)
    saveError = undefined
    void updateTarget()
  }

  /** Removes visual emphasis from the previous element. */
  function clearTarget (): void {
    target?.classList.remove('guided-tour-target')
    target = undefined
  }

  /** Finds and frames the element for the active tour step. */
  async function updateTarget (retry = true): Promise<void> {
    clearTarget()
    await tick()
    const nextTarget = document.querySelector<HTMLElement>(steps[stepIndex].selector)
    if (nextTarget === undefined || nextTarget === null) {
      if (retry) {
        clearTimeout(retryTimer)
        retryTimer = setTimeout(() => void updateTarget(false), 300)
      }
      return
    }
    target = nextTarget
    const rect = target.getBoundingClientRect()
    spotlight = { top: Math.max(rect.top - 6, 0), left: Math.max(rect.left - 6, 0), width: rect.width + 12, height: rect.height + 12 }
    target.classList.add('guided-tour-target')
    await tick()
    nextButton?.focus()
  }

  /** Creates the central status record once for the current account. */
  async function ensurePreference (currentStep: number): Promise<Ref<GuidedTourPreference>> {
    if (preferenceId !== undefined) return preferenceId
    if (createPreferencePromise !== undefined) return await createPreferencePromise
    createPreferencePromise = client.createDoc(guidedTourPreferenceClass, core.space.Workspace, { attachedTo: account.uuid, currentStep })
    try {
      preferenceId = await createPreferencePromise
      return preferenceId
    } finally {
      createPreferencePromise = undefined
    }
  }

  /** Saves progress centrally; final completion retains its timestamp. */
  async function saveProgress (currentStep: number, completed = false): Promise<boolean> {
    try {
      const id = await ensurePreference(currentStep)
      await client.updateDoc(guidedTourPreferenceClass, core.space.Workspace, id, {
        currentStep,
        ...(completed ? { completedOn: Date.now() } : {})
      })
      return true
    } catch {
      saveError = 'No pudimos guardar tu avance. Revisa tu conexión e inténtalo otra vez.'
      return false
    }
  }

  /** Advances to the next instruction or records final completion. */
  async function next (): Promise<void> {
    if (saving) return
    saving = true
    const completed = stepIndex === steps.length - 1
    const saved = await saveProgress(completed ? stepIndex : stepIndex + 1, completed)
    saving = false
    if (!saved) return
    if (completed) {
      clearTimeout(retryTimer)
      clearTarget()
      active = false
    } else {
      stepIndex += 1
      void updateTarget()
    }
  }

  /** Returns to the preceding instruction when one exists. */
  function previous (): void {
    if (stepIndex === 0) return
    stepIndex -= 1
    void updateTarget()
  }

  /** Advances steps explicitly completed by clicking their highlighted target. */
  function handleTargetClick (event: MouseEvent): void {
    if (!active || !steps[stepIndex].advanceOnTargetClick || target === undefined) return
    if (event.target instanceof Node && target.contains(event.target)) void next()
  }

  /** Repositions the frame after viewport changes. */
  function handleResize (): void {
    if (active) void updateTarget()
  }

  window.addEventListener('click', handleTargetClick, true)
  window.addEventListener('resize', handleResize)

  onDestroy(() => {
    clearTimeout(retryTimer)
    clearTarget()
    unsubscribeTour()
    unsubscribeLocation()
    window.removeEventListener('click', handleTargetClick, true)
    window.removeEventListener('resize', handleResize)
  })
</script>

{#if active}
  <div class="guided-tour-spotlight" style:top={`${spotlight.top}px`} style:left={`${spotlight.left}px`} style:width={`${spotlight.width}px`} style:height={`${spotlight.height}px`} />
  <section class="guided-tour-card" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
    <span class="guided-tour-step">Paso {stepIndex + 1} de {steps.length}</span>
    <h2 id="guided-tour-title">{steps[stepIndex].title}</h2>
    <p>{steps[stepIndex].description}</p>
    {#if !target}<p class="guided-tour-hint">Completa el paso anterior o navega hasta esa pantalla; la guía lo resaltará al aparecer.</p>{/if}
    {#if saveError}<p class="guided-tour-error" role="alert">{saveError}</p>{/if}
    <div class="guided-tour-actions">
      <div class="guided-tour-navigation">
        {#if stepIndex > 0}<button type="button" on:click={previous}>Anterior</button>{/if}
        <button type="button" class="guided-tour-next" bind:this={nextButton} disabled={saving} on:click={next}>
          {saving ? 'Guardando…' : stepIndex === steps.length - 1 ? 'Finalizar' : 'Siguiente'}
        </button>
      </div>
    </div>
  </section>
{/if}

<style lang="scss">
  :global(.guided-tour-target) { position: relative; z-index: 1001 !important; border-radius: 0.5rem; }
  .guided-tour-spotlight { position: fixed; z-index: 1000; pointer-events: none; border: 2px solid var(--button-primary-BackgroundColor); border-radius: 0.625rem; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.58); transition: all 0.18s var(--timing-main); }
  .guided-tour-card { position: fixed; z-index: 1002; right: 1.5rem; bottom: 1.5rem; width: min(24rem, calc(100vw - 2rem)); padding: 1.25rem; color: var(--theme-content-color); background: var(--theme-popup-color); border: 1px solid var(--theme-button-border); border-radius: 0.75rem; box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.35); }
  .guided-tour-step, .guided-tour-hint, .guided-tour-error { color: var(--theme-dark-color); font-size: 0.8125rem; }
  h2 { margin: 0.5rem 0; font-size: 1.125rem; }
  p { margin: 0; line-height: 1.45; }
  .guided-tour-hint, .guided-tour-error { margin-top: 0.75rem; }
  .guided-tour-error { color: var(--button-negative-BackgroundColor); }
  .guided-tour-actions, .guided-tour-navigation { display: flex; align-items: center; gap: 0.5rem; }
  .guided-tour-actions { justify-content: flex-end; margin-top: 1.25rem; }
  button { min-height: 2rem; padding: 0.375rem 0.75rem; color: var(--theme-content-color); background: transparent; border: 1px solid var(--theme-button-border); border-radius: 0.375rem; cursor: pointer; }
  .guided-tour-next { color: var(--primary-button-color); background: var(--button-primary-BackgroundColor); border-color: var(--button-primary-BackgroundColor); }
  button:focus-visible { outline: 2px solid var(--primary-button-outline); outline-offset: 2px; }
  @media (max-width: 480px) { .guided-tour-card { right: 1rem; bottom: 1rem; left: 1rem; width: auto; } }
</style>
