<script lang="ts">
  import core, { getCurrentAccount, type Class, type ModulePermissionGroup, type Ref } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { trackerId } from '@hcengineering/tracker'
  import { getCurrentLocation, location, navigate, showPopup, type PopupResult } from '@hcengineering/ui'
  import workbench, { type Application } from '@hcengineering/workbench'
  import type { GuidedTourPreference } from '@hcengineering/workbench/src/types'
  import { onDestroy, tick } from 'svelte'
  import { guidedTourStarts } from '../guidedTour'
  import { getGuidedTourPhase, getGuidedTourStep, type GuidedTourPhase } from '../guidedTourState'
  import { getOpsTourSteps, isOpsApplication, type TourCardAction, type TourStep } from '../opsTour'
  import { filterVisibleApplications, getDisabledApplications } from '../utils'
  import GuidedTourCard from './GuidedTourCard.svelte'
  import GuidedTourShield from './GuidedTourShield.svelte'

  const account = getCurrentAccount()
  const client = getClient()
  const preferenceQuery = createQuery()
  const hiddenAppsQuery = createQuery()
  const modulePermissionsQuery = createQuery()
  const allApps = client.getModel().findAllSync<Application>(workbench.class.Application, {})
  const guidedTourPreferenceClass = (workbench.class as typeof workbench.class & {
    GuidedTourPreference: Ref<Class<GuidedTourPreference>>
  }).GuidedTourPreference
  const tourCardActions = new Set<TourCardAction>(['start', 'next', 'previous', 'retry', 'skip'])

  let active = false
  let phase: GuidedTourPhase = 'activation'
  let steps: TourStep[] = []
  let stepIndex = 0
  let panelStepIndex = 0
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
  let tutorialPopup: PopupResult | undefined
  let tourPanelPopup: PopupResult | undefined
  let tutorialShield: PopupResult | undefined
  let failedStep: number | undefined
  let spotlight = { top: 0, left: 0, width: 0, height: 0 }

  const unsubscribeTour = guidedTourStarts.subscribe((started) => {
    if (started === 0) return
    restartRequested = true
    startWhenReady()
  })
  const unsubscribeLocation = location.subscribe(() => {
    if (active && phase === 'tour') void updateTarget(panelStepIndex)
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
      openTourPanel()
    })
    if (phase === 'activation') openActivation()
    else openTour(getGuidedTourStep(savedPreference?.currentStep, steps.length))
  }

  /** Opens the mandatory activation screen before the real tour. */
  function openActivation (): void {
    closeDemonstration()
    closeTourPanel()
    clearTarget()
    phase = 'activation'
    active = true
    saveError = undefined
    openTourPanel()
  }

  /** Opens the real tour from a persisted or explicit step. */
  function openTour (step: number): void {
    phase = 'tour'
    active = true
    stepIndex = getGuidedTourStep(step, steps.length)
    panelStepIndex = stepIndex
    saveError = undefined
    void presentStep(stepIndex)
  }

  /** Removes visual emphasis from the previous element. */
  function clearTarget (): void {
    target?.classList.remove('guided-tour-target')
    target = undefined
  }

  /** Closes the panel added by the tour itself. */
  function closeTourPanel (): void {
    tourPanelPopup?.close()
    tourPanelPopup = undefined
  }

  /** Closes the demonstration form and its interaction guard. */
  function closeDemonstration (): void {
    tutorialShield?.close()
    tutorialShield = undefined
    tutorialPopup?.close()
    tutorialPopup = undefined
  }

  /** Opens the tour controls through the standard popup stack. */
  function openTourPanel (): void {
    if (!active) return
    closeTourPanel()
    tourPanelPopup = showPopup(
      GuidedTourCard,
      {
        phase,
        step: phase === 'tour' ? steps[panelStepIndex] : undefined,
        stepIndex: panelStepIndex,
        stepsCount: steps.length,
        saving,
        saveError,
        failedStep
      },
      'top',
      undefined,
      handleTourPanelUpdate,
      { category: 'guided-tour', overlay: false }
    )
  }

  /** Blocks all interactions with a demonstration modal without covering the tour controls. */
  function openInteractionShield (): void {
    if (tutorialShield !== undefined) return
    tutorialShield = showPopup(
      GuidedTourShield,
      {},
      'movable',
      undefined,
      undefined,
      { category: 'guided-tour-shield', overlay: true }
    )
  }

  /** Routes validated actions emitted by the popup-hosted tour controls. */
  function handleTourPanelUpdate (value: unknown): void {
    if (typeof value !== 'string' || !tourCardActions.has(value as TourCardAction) || saving) return
    switch (value as TourCardAction) {
      case 'start':
        void startTour()
        return
      case 'next':
        void next()
        return
      case 'previous':
        void previous()
        return
      case 'retry':
        retry()
        return
      case 'skip':
        void skipFailedStep()
    }
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
  async function updateTarget (index = panelStepIndex): Promise<boolean> {
    const step = steps[index]
    if (step === undefined) return false
    clearTarget()
    await tick()
    const nextTarget = await findTarget(step.selector)
    if (nextTarget === undefined) {
      saveError = 'No pudimos mostrar esta parte de la guía. Pulsa Reintentar para volver a intentarlo.'
      return false
    }
    target = nextTarget
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    const rect = target.getBoundingClientRect()
    spotlight = { top: Math.max(rect.top - 6, 0), left: Math.max(rect.left - 6, 0), width: rect.width + 12, height: rect.height + 12 }
    target.classList.add('guided-tour-target')
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
    tutorialPopup = showPopup(
      tracker.component.CreateIssue,
      { shouldSaveDraft: false, initialTitle: 'Ejemplo: revisar propuesta' },
      'top'
    )
  }

  /** Opens a project or global view and its real selector without changing the selected view. */
  async function openBoard (): Promise<void> {
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
    panelStepIndex = index
    closeTourPanel()
    const step = steps[index]
    if (step === undefined) {
      failedStep = index
      saveError = 'No encontramos este paso de la guía. Pulsa Reintentar para actualizar el recorrido.'
      return false
    }
    if (step.surface !== 'popup') closeDemonstration()
    try {
      await runStepAction(step)
      if (step.surface === 'popup') openInteractionShield()
      const shown = await updateTarget(index)
      failedStep = shown ? undefined : index
      return shown
    } catch (error) {
      failedStep = index
      saveError = error instanceof Error ? error.message : 'No pudimos mostrar esta parte de la guía. Pulsa Reintentar para volver a intentarlo.'
      return false
    }
  }

  /** Shows a step and restores the controls above every active popup. */
  async function presentStep (index: number): Promise<boolean> {
    const shown = await showStep(index)
    openTourPanel()
    return shown
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
      openTourPanel()
    } finally {
      saving = false
      if (active) openTourPanel()
    }
  }

  /** Advances after the next real interface state is visible and progress is saved. */
  async function next (): Promise<void> {
    if (saving) return
    if (panelStepIndex === steps.length - 1) {
      saving = true
      const saved = await saveProgress(panelStepIndex, true)
      saving = false
      if (!saved) {
        openTourPanel()
        return
      }
      closeTourPanel()
      closeDemonstration()
      clearTarget()
      active = false
      phase = 'completed'
      return
    }
    const nextStep = panelStepIndex + 1
    saving = true
    const shown = await showStep(nextStep)
    if (shown) {
      const saved = await saveProgress(nextStep)
      if (saved) stepIndex = nextStep
    }
    saving = false
    openTourPanel()
  }

  /** Records a failed demonstration and continues with the next functionality step. */
  async function skipFailedStep (): Promise<void> {
    if (saving || failedStep === undefined) return
    const nextStep = failedStep + 1
    saving = true
    if (nextStep >= steps.length) {
      const saved = await saveProgress(failedStep, true)
      if (saved) {
        closeTourPanel()
        closeDemonstration()
        clearTarget()
        active = false
        phase = 'completed'
      }
    } else {
      const shown = await showStep(nextStep)
      if (shown) {
        const saved = await saveProgress(nextStep)
        if (saved) stepIndex = nextStep
      }
    }
    saving = false
    if (active) openTourPanel()
  }

  /** Moves back through the same visible interface states. */
  async function previous (): Promise<void> {
    if (saving || panelStepIndex === 0) return
    const previousStep = panelStepIndex - 1
    saving = true
    const shown = await showStep(previousStep)
    if (shown) {
      const saved = await saveProgress(previousStep)
      if (saved) stepIndex = previousStep
    }
    saving = false
    openTourPanel()
  }

  /** Retries the active transition without advancing progress. */
  function retry (): void {
    if (!saving) void presentStep(panelStepIndex)
  }

  /** Repositions the frame after viewport changes. */
  function handleResize (): void {
    if (active && phase === 'tour') void updateTarget(panelStepIndex)
  }

  window.addEventListener('resize', handleResize)

  onDestroy(() => {
    closeTourPanel()
    closeDemonstration()
    clearTarget()
    unsubscribeTour()
    unsubscribeLocation()
    window.removeEventListener('resize', handleResize)
  })
</script>

{#if active && phase === 'tour'}
  <div class="guided-tour-spotlight" style:top={`${spotlight.top}px`} style:left={`${spotlight.left}px`} style:width={`${spotlight.width}px`} style:height={`${spotlight.height}px`} />
{/if}

<style lang="scss">
  :global(.guided-tour-target) { position: relative; z-index: 1001 !important; border-radius: 0.5rem; }
  .guided-tour-spotlight { position: fixed; z-index: 1000; pointer-events: none; border: 2px solid var(--button-primary-BackgroundColor); border-radius: 0.625rem; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.58); transition: all 0.18s var(--timing-main); }
</style>
