<script lang="ts">
  import core, { getCurrentAccount, type Class, type ModulePermissionGroup, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { trackerId } from '@hcengineering/tracker'
  import { getCurrentLocation, Label, location, navigate, showPopup, type PopupResult } from '@hcengineering/ui'
  import workbench, { type Application } from '@hcengineering/workbench'
  import type { GuidedTourPreference } from '@hcengineering/workbench/src/types'
  import { onDestroy, tick } from 'svelte'
  import { guidedTourStarts } from '../guidedTour'
  import { getGuidedTourPhase, getGuidedTourStep, type GuidedTourPhase } from '../guidedTourState'
  import { getOpsTourSteps, isOpsApplication, type TourStep } from '../opsTour'
  import { filterVisibleApplications, getDisabledApplications } from '../utils'

  const account = getCurrentAccount()
  const client = getClient()
  const preferenceQuery = createQuery()
  const hiddenAppsQuery = createQuery()
  const modulePermissionsQuery = createQuery()
  const allApps = client.getModel().findAllSync<Application>(workbench.class.Application, {})
  const guidedTourPreferenceClass = (workbench.class as typeof workbench.class & {
    GuidedTourPreference: Ref<Class<GuidedTourPreference>>
  }).GuidedTourPreference
  let active = false
  let phase: GuidedTourPhase = 'activation'
  let steps: TourStep[] = []
  let stepIndex = 0
  let hiddenApps: Array<Ref<Application>> = []
  let disabledApps = new Set<Ref<Application>>()
  let hiddenAppsLoaded = false
  let permissionsLoaded = false
  let preferenceLoaded = false
  let savedPreference: GuidedTourPreference | undefined
  let hasStarted = false
  let restartRequested = false
  let preferenceId: Ref<GuidedTourPreference> | undefined
  let createPreferencePromise: Promise<Ref<GuidedTourPreference>> | undefined
  let saving = false
  let saveError: string | undefined
  let target: HTMLElement | undefined
  let nextButton: HTMLButtonElement | undefined
  let tutorialPopup: PopupResult | undefined
  let failedStep: number | undefined
  let spotlight = { top: 0, left: 0, width: 0, height: 0 }

  const unsubscribeTour = guidedTourStarts.subscribe((started) => {
    if (started === 0) return
    restartRequested = true
    startWhenReady()
  })
  const unsubscribeLocation = location.subscribe(() => {
    if (active && phase === 'tour') void updateTarget()
  })

  hiddenAppsQuery.query(workbench.class.HiddenApplication, { space: core.space.Workspace }, (records) => {
    hiddenApps = records.map((record) => record.attachedTo)
    hiddenAppsLoaded = true
    startWhenReady()
  })
  modulePermissionsQuery.query(core.class.ModulePermissionGroup, {}, (records) => {
    disabledApps = getDisabledApplications(records as ModulePermissionGroup[])
    permissionsLoaded = true
    startWhenReady()
  })
  preferenceQuery.query(guidedTourPreferenceClass, { space: core.space.Workspace, attachedTo: account.uuid }, (records) => {
    savedPreference = records[0]
    preferenceId = savedPreference?._id
    preferenceLoaded = true
    startWhenReady()
  }, { limit: 1 })

  $: steps = getOpsTourSteps(
    filterVisibleApplications(allApps, hiddenApps, disabledApps)
      .filter(isOpsApplication)
      .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))
  )
  $: startWhenReady()

  /** Starts the tour only when user preferences and visible functionality are loaded. */
  function startWhenReady (): void {
    if (!hiddenAppsLoaded || !permissionsLoaded || !preferenceLoaded || steps.length === 0) return
    if (restartRequested) {
      restartRequested = false
      if (phase === 'activation') openActivation()
      else openTour(0)
      return
    }
    if (hasStarted) return
    hasStarted = true
    phase = getGuidedTourPhase(savedPreference?.activatedOn, savedPreference?.completedOn)
    if (phase === 'completed') return
    void ensurePreference(savedPreference?.currentStep ?? 0).catch(() => {
      saveError = 'No pudimos crear el registro del tutorial. Revisa tu conexión e inténtalo otra vez.'
    })
    if (phase === 'activation') openActivation()
    else openTour(getGuidedTourStep(savedPreference?.currentStep, steps.length))
  }

  /** Opens the mandatory activation screen before the real tour. */
  function openActivation (): void {
    closeTutorialPopup()
    clearTarget()
    phase = 'activation'
    active = true
    saveError = undefined
  }

  /** Opens the real tour from a persisted or explicit step. */
  function openTour (step: number): void {
    phase = 'tour'
    active = true
    stepIndex = getGuidedTourStep(step, steps.length)
    saveError = undefined
    void showStep(stepIndex)
  }

  /** Removes visual emphasis from the previous element. */
  function clearTarget (): void {
    target?.classList.remove('guided-tour-target')
    target = undefined
  }

  /** Closes only the popup created by the tutorial. */
  function closeTutorialPopup (): void {
    tutorialPopup?.close()
    tutorialPopup = undefined
  }

  /** Waits for a rendered target after a navigation or popup transition. */
  async function findTarget (selector: string): Promise<HTMLElement | undefined> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const element = document.querySelector<HTMLElement>(selector)
      if (element !== null) return element
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }

  /** Finds and frames the rendered element for the current step. */
  async function updateTarget (index = stepIndex): Promise<boolean> {
    clearTarget()
    await tick()
    const nextTarget = await findTarget(steps[index].selector)
    if (nextTarget === undefined) {
      saveError = 'No pudimos mostrar esta parte de la guía. Pulsa Reintentar para volver a intentarlo.'
      return false
    }
    target = nextTarget
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    const rect = target.getBoundingClientRect()
    spotlight = { top: Math.max(rect.top - 6, 0), left: Math.max(rect.left - 6, 0), width: rect.width + 12, height: rect.height + 12 }
    target.classList.add('guided-tour-target')
    await tick()
    nextButton?.focus()
    return true
  }

  /** Navigates to a visible Ops functionality without depending on a click target. */
  function openApplication (appAlias: string | undefined): void {
    if (appAlias === undefined) throw new Error('No encontramos la funcionalidad de Ops.')
    const currentLocation = getCurrentLocation()
    navigate({ ...currentLocation, path: [...currentLocation.path.slice(0, 2), appAlias], fragment: undefined, query: undefined })
  }

  /** Opens the real action menu while leaving every action unselected. */
  async function openNewMenu (): Promise<void> {
    const header = await findTarget('[data-tutorial="tracker-new-item"]')
    const buttons = header?.querySelectorAll<HTMLButtonElement>('button')
    const button = buttons !== undefined ? buttons[buttons.length - 1] : undefined
    if (button === undefined || button === null) throw new Error('No encontramos el menú de creación.')
    button.click()
  }

  /** Opens a non-persistent process form for the tutorial. */
  function openIssueForm (): void {
    closeTutorialPopup()
    tutorialPopup = showPopup(
      tracker.component.CreateIssue,
      { shouldSaveDraft: false, initialTitle: 'Ejemplo: revisar propuesta' },
      'top'
    )
  }

  /** Opens a project or global view and its real selector without changing the selected view. */
  async function openBoard (): Promise<void> {
    closeTutorialPopup()
    const project = await client.findOne(tracker.class.Project, { members: account.uuid })
    const currentLocation = getCurrentLocation()
    navigate({
      ...currentLocation,
      path: [...currentLocation.path.slice(0, 2), trackerId, ...(project !== undefined ? [project._id, 'issues'] : ['issues'])],
      fragment: undefined,
      query: undefined
    })
    const selector = await findTarget('[data-tutorial="viewlet-selector"]')
    const button = selector?.querySelector<HTMLButtonElement>('button')
    if (button === undefined || button === null) throw new Error('No encontramos el selector de vista.')
    button.click()
  }

  /** Performs the interface transition required before rendering a step. */
  async function runStepAction (step: TourStep): Promise<void> {
    switch (step.action) {
      case 'openApplication':
        closeTutorialPopup()
        openApplication(step.appAlias)
        return
      case 'openNewMenu':
        await openNewMenu()
        return
      case 'openIssueForm':
        openIssueForm()
        return
      case 'openBoard':
        await openBoard()
    }
  }

  /** Renders a step only after its required interface state is available. */
  async function showStep (index: number): Promise<boolean> {
    saveError = undefined
    const step = steps[index]
    if (step === undefined) {
      failedStep = index
      saveError = 'No encontramos este paso de la guía. Pulsa Reintentar para actualizar el recorrido.'
      return false
    }
    try {
      await runStepAction(step)
      const shown = await updateTarget(index)
      failedStep = shown ? undefined : index
      return shown
    } catch (error) {
      failedStep = index
      saveError = error instanceof Error ? error.message : 'No pudimos mostrar esta parte de la guía. Pulsa Reintentar para volver a intentarlo.'
      return false
    }
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

  /** Records activation before allowing the real tutorial to start. */
  async function startTour (): Promise<void> {
    if (saving) return
    saving = true
    try {
      const id = await ensurePreference(0)
      await client.updateDoc(guidedTourPreferenceClass, core.space.Workspace, id, { activatedOn: Date.now(), currentStep: 0 })
      openTour(0)
    } catch {
      saveError = 'No pudimos activar el tutorial. Revisa tu conexión e inténtalo otra vez.'
    } finally {
      saving = false
    }
  }

  /** Advances after the next real interface state is visible and progress is saved. */
  async function next (): Promise<void> {
    if (saving) return
    if (stepIndex === steps.length - 1) {
      saving = true
      const saved = await saveProgress(stepIndex, true)
      saving = false
      if (!saved) return
      closeTutorialPopup()
      clearTarget()
      active = false
      phase = 'completed'
      return
    }
    const nextStep = stepIndex + 1
    saving = true
    const shown = await showStep(nextStep)
    if (shown) {
      const saved = await saveProgress(nextStep)
      if (saved) stepIndex = nextStep
    }
    saving = false
  }

  /** Records a failed demonstration and continues with the next functionality step. */
  async function skipFailedStep (): Promise<void> {
    if (saving || failedStep === undefined) return
    const nextStep = failedStep + 1
    saving = true
    if (nextStep >= steps.length) {
      const saved = await saveProgress(failedStep, true)
      if (saved) {
        closeTutorialPopup()
        clearTarget()
        active = false
        phase = 'completed'
      }
    } else {
      const saved = await saveProgress(nextStep)
      if (saved) {
        stepIndex = nextStep
        await showStep(nextStep)
      }
    }
    saving = false
  }

  /** Moves back through the same visible interface states. */
  async function previous (): Promise<void> {
    if (saving || stepIndex === 0) return
    saving = true
    const previousStep = stepIndex - 1
    const shown = await showStep(previousStep)
    if (shown) {
      const saved = await saveProgress(previousStep)
      if (saved) stepIndex = previousStep
    }
    saving = false
  }

  /** Retries the active transition without advancing progress. */
  function retry (): void {
    if (!saving) void showStep(stepIndex)
  }

  /** Repositions the frame after viewport changes. */
  function handleResize (): void {
    if (active && phase === 'tour') void updateTarget()
  }

  window.addEventListener('resize', handleResize)

  onDestroy(() => {
    closeTutorialPopup()
    clearTarget()
    unsubscribeTour()
    unsubscribeLocation()
    window.removeEventListener('resize', handleResize)
  })
</script>

{#if active}
  {#if phase === 'tour'}
    <div class="guided-tour-spotlight" style:top={`${spotlight.top}px`} style:left={`${spotlight.left}px`} style:width={`${spotlight.width}px`} style:height={`${spotlight.height}px`} />
  {/if}
  <section class="guided-tour-card" role="dialog" aria-modal="true" aria-labelledby="guided-tour-title">
    {#if phase === 'activation'}
      <span class="guided-tour-step">Tutorial obligatorio</span>
      <h2 id="guided-tour-title">Conoce las funcionalidades de Ops</h2>
      <p>Verás cada funcionalidad activa y su recorrido principal sin crear datos de ejemplo.</p>
    {:else}
      <span class="guided-tour-step">Paso {stepIndex + 1} de {steps.length}</span>
      <h2 id="guided-tour-title">{steps[stepIndex].title}</h2>
      {#if steps[stepIndex].moduleLabel !== undefined}<p class="guided-tour-module"><Label label={steps[stepIndex].moduleLabel} /></p>{/if}
      <p>{steps[stepIndex].description}</p>
    {/if}
    {#if saveError}<p class="guided-tour-error" role="alert">{saveError}</p>{/if}
    <div class="guided-tour-actions">
      {#if phase === 'tour' && saveError}
        <button type="button" on:click={retry}>Reintentar</button>
        {#if failedStep !== undefined}<button type="button" disabled={saving} on:click={skipFailedStep}>Omitir por ahora</button>{/if}
      {/if}
      <div class="guided-tour-navigation">
        {#if phase === 'tour' && stepIndex > 0}<button type="button" disabled={saving} on:click={previous}>Anterior</button>{/if}
        <button type="button" class="guided-tour-next" bind:this={nextButton} disabled={saving} on:click={phase === 'activation' ? startTour : next}>
          {saving ? 'Guardando…' : phase === 'activation' ? 'Comenzar' : stepIndex === steps.length - 1 ? 'Finalizar' : 'Siguiente'}
        </button>
      </div>
    </div>
  </section>
{/if}

<style lang="scss">
  :global(.guided-tour-target) { position: relative; z-index: 1001 !important; border-radius: 0.5rem; }
  .guided-tour-spotlight { position: fixed; z-index: 1000; pointer-events: none; border: 2px solid var(--button-primary-BackgroundColor); border-radius: 0.625rem; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.58); transition: all 0.18s var(--timing-main); }
  .guided-tour-card { position: fixed; z-index: 1002; right: 1.5rem; bottom: 1.5rem; width: min(24rem, calc(100vw - 2rem)); padding: 1.25rem; color: var(--theme-content-color); background: var(--theme-popup-color); border: 1px solid var(--theme-button-border); border-radius: 0.75rem; box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.35); }
  .guided-tour-step, .guided-tour-error, .guided-tour-module { color: var(--theme-dark-color); font-size: 0.8125rem; }
  h2 { margin: 0.5rem 0; font-size: 1.125rem; }
  p { margin: 0; line-height: 1.45; }
  .guided-tour-error { margin-top: 0.75rem; color: var(--button-negative-BackgroundColor); }
  .guided-tour-module { margin-bottom: 0.5rem; font-weight: 600; }
  .guided-tour-actions, .guided-tour-navigation { display: flex; align-items: center; gap: 0.5rem; }
  .guided-tour-actions { justify-content: space-between; margin-top: 1.25rem; }
  .guided-tour-navigation { margin-left: auto; }
  button { min-height: 2rem; padding: 0.375rem 0.75rem; color: var(--theme-content-color); background: transparent; border: 1px solid var(--theme-button-border); border-radius: 0.375rem; cursor: pointer; }
  .guided-tour-next { color: var(--primary-button-color); background: var(--button-primary-BackgroundColor); border-color: var(--button-primary-BackgroundColor); }
  button:focus-visible { outline: 2px solid var(--primary-button-outline); outline-offset: 2px; }
  @media (max-width: 480px) { .guided-tour-card { right: 1rem; bottom: 1rem; left: 1rem; width: auto; } }
</style>
