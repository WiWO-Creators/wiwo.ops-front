<script lang="ts">
  import calendar from '@hcengineering/calendar'
  import core, {
    AccountRole,
    getCurrentAccount,
    hasAccountRole,
    type ModulePermissionGroup,
    type Ref
  } from '@hcengineering/core'
  import { loveId } from '@hcengineering/love'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import tracker, { trackerId } from '@hcengineering/tracker'
  import {
    getCurrentLocation,
    location,
    navigate,
    popupstore,
    showPopup,
    type CompAndProps,
    type PopupAlignment,
    type PopupResult
  } from '@hcengineering/ui'
  import workbench, { type Application } from '@hcengineering/workbench'
  import type { GuidedTourPreference } from '@hcengineering/workbench/src/types'
  import { onDestroy, tick } from 'svelte'
  import { get } from 'svelte/store'
  import { guidedTourStarts } from '../guidedTour'
  import {
    getGuidedTourStorageKey,
    readGuidedTourProgress,
    writeGuidedTourProgress,
    type GuidedTourLocalProgress
  } from '../guidedTourProgress'
  import { getGuidedTourPhase, getGuidedTourStep, type GuidedTourPhase } from '../guidedTourState'
  import {
    getOpsTourSteps,
    guidedTourConfig,
    isGuidedTourApplication,
    type TourCardAction,
    type TourStep
  } from '../opsTour'
  import { filterVisibleApplications, getDisabledApplications } from '../utils'
  import GuidedTourCard from './GuidedTourCard.svelte'
  import GuidedTourDemoHost from './GuidedTourDemoHost.svelte'
  import GuidedTourShield from './GuidedTourShield.svelte'

  const account = getCurrentAccount()
  const client = getClient()
  const preferenceQuery = createQuery()
  const hiddenAppsQuery = createQuery()
  const modulePermissionsQuery = createQuery()
  const allApps = client.getModel().findAllSync<Application>(workbench.class.Application, {})
  const guidedTourPreferenceClass = workbench.class.GuidedTourPreference
  const supportsRemoteProgress = client.getHierarchy().hasClass(guidedTourPreferenceClass) === true
  const tourCardActions = new Set<TourCardAction>(['start', 'next', 'previous'])
  const workspace = String(getCurrentLocation().path[1] ?? 'workspace')
  const storageKey = getGuidedTourStorageKey(workspace, account.uuid)
  const progressStorage = getProgressStorage()

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
  let startupExpired = false
  let stepsLocked = false
  let savedPreference: GuidedTourPreference | undefined
  let localProgress: GuidedTourLocalProgress | undefined
  let hasStarted = false
  let restartRequested = false
  let preferenceId: Ref<GuidedTourPreference> | undefined
  let createPreferencePromise: Promise<Ref<GuidedTourPreference>> | undefined
  let syncPromise: Promise<void> | undefined
  let saving = false
  let usingDemo = false
  let currentDemo: string | undefined
  let target: HTMLElement | undefined
  let targetObserver: ResizeObserver | undefined
  let geometryFrame: number | undefined
  let tutorialPopup: PopupResult | undefined
  let tourPanelPopup: PopupResult | undefined
  let tutorialShield: PopupResult | undefined
  let presentationRequest = 0
  let spotlight = { top: 0, left: 0, width: 0, height: 0 }

  const startupTimer = setTimeout(() => {
    startupExpired = true
    startWhenReady()
  }, guidedTourConfig.startupWaitMs)

  const unsubscribeTour = guidedTourStarts.subscribe((started) => {
    if (started === 0) return
    restartRequested = true
    startWhenReady()
  })
  const unsubscribeLocation = location.subscribe(() => {
    if (active && phase === 'tour' && !saving) scheduleGeometryUpdate()
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
  if (supportsRemoteProgress) {
    preferenceQuery.query(
      guidedTourPreferenceClass,
      { space: core.space.Workspace, attachedTo: account.uuid },
      (records) => {
        const firstResponse = !preferenceLoaded
        savedPreference = records[0]
        preferenceId = savedPreference?._id
        preferenceLoaded = true
        if (hasStarted && firstResponse && localProgress?.pendingSync !== true && savedPreference !== undefined) {
          applyRemoteProgress(savedPreference)
          return
        }
        if (localProgress?.pendingSync === true) void syncLocalProgress()
        startWhenReady()
      },
      { limit: 1 }
    )
  } else {
    preferenceLoaded = true
  }

  $: if (!stepsLocked) {
    steps = getOpsTourSteps(
      filterVisibleApplications(allApps, hiddenApps, disabledApps)
        .filter(isGuidedTourApplication)
        .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity)),
      hasAccountRole(account, AccountRole.Maintainer)
    )
  }
  $: startWhenReady()

  /** Starts from backend state when available and from local state when services are unavailable. */
  function startWhenReady (): void {
    if (steps.length === 0) return
    if (!startupExpired && (!hiddenAppsLoaded || !permissionsLoaded || !preferenceLoaded)) return
    if (hasStarted) {
      if (!restartRequested) return
      restartRequested = false
      if (phase === 'activation') openActivation()
      else openTour(0)
      return
    }

    hasStarted = true
    stepsLocked = true
    clearTimeout(startupTimer)
    localProgress = readGuidedTourProgress(progressStorage, storageKey, steps.length)
    if (localProgress === undefined && savedPreference !== undefined) {
      localProgress = storeRemoteProgress(savedPreference)
    }
    const progress = localProgress?.pendingSync === true ? localProgress : (savedPreference ?? localProgress)
    phase = getGuidedTourPhase(progress?.activatedOn, progress?.completedOn)
    if (localProgress?.pendingSync === true) void syncLocalProgress()
    if (phase === 'completed') return
    if (phase === 'activation') openActivation()
    else openTour(getGuidedTourStep(progress?.currentStep, steps.length))
  }

  /** Reconciles the first delayed backend response without replacing newer local interactions. */
  function applyRemoteProgress (preference: GuidedTourPreference): void {
    localProgress = storeRemoteProgress(preference)
    phase = getGuidedTourPhase(preference.activatedOn, preference.completedOn)
    if (phase === 'completed') {
      closeTourPanel()
      closeDemonstration()
      clearTarget()
      active = false
    } else if (phase === 'tour') {
      openTour(localProgress.currentStep)
    }
  }

  /** Mirrors a validated backend snapshot into the offline progress cache. */
  function storeRemoteProgress (preference: GuidedTourPreference): GuidedTourLocalProgress {
    const progress = {
      currentStep: getGuidedTourStep(preference.currentStep, steps.length),
      activatedOn: preference.activatedOn,
      completedOn: preference.completedOn,
      pendingSync: false,
      updatedOn: Date.now()
    }
    writeGuidedTourProgress(progressStorage, storageKey, progress)
    return progress
  }

  /** Opens the mandatory activation screen before the real tour. */
  function openActivation (): void {
    closeDemonstration()
    closeTourPanel()
    clearTarget()
    phase = 'activation'
    active = true
    usingDemo = false
    openTourPanel()
  }

  /** Opens the tour from a persisted or explicit step. */
  function openTour (step: number): void {
    phase = 'tour'
    active = true
    stepIndex = getGuidedTourStep(step, steps.length)
    panelStepIndex = stepIndex
    void presentStep(stepIndex)
  }

  /** Stops observing the previous target. */
  function clearTarget (): void {
    targetObserver?.disconnect()
    targetObserver = undefined
    target = undefined
  }

  /** Closes the panel added by the tour itself. */
  function closeTourPanel (): void {
    tourPanelPopup?.close()
    tourPanelPopup = undefined
  }

  /** Closes the current real or fallback surface and its interaction guard. */
  function closeDemonstration (): void {
    tutorialShield?.close()
    tutorialShield = undefined
    tutorialPopup?.close()
    tutorialPopup = undefined
    usingDemo = false
    currentDemo = undefined
  }

  /** Anchors controls beside the highlighted production component. */
  function getTourPanelAlignment (): PopupAlignment {
    const panelTarget = target
    if (phase !== 'tour' || panelTarget === undefined) return 'top'
    return { getBoundingClientRect: () => panelTarget.getBoundingClientRect() }
  }

  /** Opens the controls above every real or fallback surface. */
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
        usingDemo
      },
      getTourPanelAlignment(),
      undefined,
      handleTourPanelUpdate,
      { category: 'guided-tour', overlay: false }
    )
  }

  /** Places dimming and click protection in the same popup stack as the target. */
  function openInteractionShield (): void {
    tutorialShield?.close()
    tutorialShield = showPopup(GuidedTourShield, { spotlight }, 'movable', undefined, undefined, {
      category: 'guided-tour-shield',
      overlay: true
    })
  }

  /** Routes validated actions emitted by the popup-hosted controls. */
  function handleTourPanelUpdate (value: unknown): void {
    if (typeof value !== 'string' || !tourCardActions.has(value as TourCardAction) || saving) return
    switch (value as TourCardAction) {
      case 'start':
        startTour()
        return
      case 'next':
        void next()
        return
      case 'previous':
        void previous()
    }
  }

  /** Waits for a target while asynchronous routes and resources render. */
  async function findTarget (selector: string, root: ParentNode = document): Promise<HTMLElement | undefined> {
    const existing = root.querySelector<HTMLElement>(selector)
    if (existing !== null) return existing
    return await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const element = root.querySelector<HTMLElement>(selector)
        if (element !== null) finish(element)
      })
      const timer = setTimeout(() => { finish(undefined) }, guidedTourConfig.targetWaitMs)
      const finish = (element: HTMLElement | undefined): void => {
        clearTimeout(timer)
        observer.disconnect()
        resolve(element)
      }
      observer.observe(root instanceof Document ? root.documentElement : root, { childList: true, subtree: true })
    })
  }

  /** Measures the target after scrolling and keeps the native-stack spotlight aligned. */
  async function frameTarget (element: HTMLElement): Promise<void> {
    clearTarget()
    target = element
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    await new Promise<void>((resolve) => requestAnimationFrame(() => { resolve() }))
    updateSpotlight()
    targetObserver = new ResizeObserver(scheduleGeometryUpdate)
    targetObserver.observe(target)
  }

  /** Updates the shield without recreating the demonstrated component. */
  function updateSpotlight (): void {
    if (target === undefined) return
    const rect = target.getBoundingClientRect()
    spotlight = {
      top: Math.max(rect.top - 6, 0),
      left: Math.max(rect.left - 6, 0),
      width: rect.width + 12,
      height: rect.height + 12
    }
    tutorialShield?.update({ spotlight })
  }

  /** Coalesces scroll and resize updates into one measurement per frame. */
  function scheduleGeometryUpdate (): void {
    if (geometryFrame !== undefined) return
    geometryFrame = requestAnimationFrame(() => {
      geometryFrame = undefined
      updateSpotlight()
    })
  }

  /** Tracks a popup opened indirectly through a real production control. */
  async function captureOpenedPopup (action: () => void): Promise<void> {
    const before = new Set(get(popupstore).map((popup) => popup.id))
    action()
    await tick()
    const opened = get(popupstore).find((popup) => !before.has(popup.id))
    if (opened === undefined) throw new Error('Production control did not open its surface.')
    tutorialPopup = popupResult(opened)
  }

  function popupResult (popup: CompAndProps): PopupResult {
    return { id: popup.id, close: popup.close, update: (props) => popup.update?.(props) }
  }

  /** Navigates to an Ops application without depending on its sidebar button. */
  function openApplication (appAlias: string | undefined): void {
    if (appAlias === undefined) throw new Error('Application alias is missing.')
    const currentLocation = getCurrentLocation()
    navigate({
      ...currentLocation,
      path: [...currentLocation.path.slice(0, 2), appAlias],
      fragment: undefined,
      query: undefined
    })
  }

  /** Opens the real creation menu without selecting an action. */
  async function openNewMenu (): Promise<void> {
    const header = await findTarget('[data-tutorial="tracker-new-item"]')
    const buttons = header?.querySelectorAll<HTMLButtonElement>('button')
    const button = buttons !== undefined ? buttons[buttons.length - 1] : undefined
    if (button === undefined || button === null) throw new Error('Creation menu is unavailable.')
    await captureOpenedPopup(() => { button.click() })
  }

  /** Opens a real process form with drafts disabled. */
  function openIssueForm (): void {
    tutorialPopup = showPopup(
      tracker.component.CreateIssue,
      { shouldSaveDraft: false, initialTitle: 'Ejemplo: revisar propuesta' },
      'top'
    )
  }

  /** Opens a real event form without saving an event. */
  function openCalendarEventForm (): void {
    tutorialPopup = showPopup(calendar.component.CreateEvent, { title: 'Ejemplo: reunión de equipo' }, 'top')
  }

  /** Opens the first rendered room without joining it. */
  async function openTeleworkRoom (): Promise<void> {
    const room = await findTarget('[data-tutorial="telework-room"]')
    if (room === undefined) throw new Error('No Telework room is available.')
    room.click()
  }

  /** Opens the real Telework maintenance layout. */
  async function openTeleworkConfigure (): Promise<void> {
    openApplication(loveId)
    const editButton = (await findTarget('[data-tutorial="telework-edit-office"]'))?.querySelector<HTMLButtonElement>(
      'button'
    )
    if (editButton === undefined || editButton === null) throw new Error('Telework maintenance is unavailable.')
    editButton.click()
  }

  /** Opens the real room-type menu without selecting an option. */
  async function openTeleworkAddRoom (): Promise<void> {
    const addButton = (await findTarget('[data-tutorial="telework-add-room"]'))?.querySelector<HTMLButtonElement>(
      'button'
    )
    if (addButton === undefined || addButton === null) throw new Error('Room creation is unavailable.')
    await captureOpenedPopup(() => { addButton.click() })
  }

  /** Opens an available issue view and its production view selector. */
  async function openBoard (): Promise<void> {
    const project = await client.findOne(tracker.class.Project, { members: account.uuid })
    const currentLocation = getCurrentLocation()
    navigate({
      ...currentLocation,
      path: [
        ...currentLocation.path.slice(0, 2),
        trackerId,
        ...(project !== undefined ? [project._id, 'issues'] : ['issues'])
      ],
      fragment: undefined,
      query: undefined
    })
    const selector = await findTarget('[data-tutorial="viewlet-selector"]')
    const button = selector?.querySelector<HTMLButtonElement>('button')
    if (button === undefined || button === null) throw new Error('Issue view selector is unavailable.')
    await captureOpenedPopup(() => { button.click() })
  }

  /** Performs the production transition required by a step. */
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
        return
      case 'openCalendarEventForm':
        openCalendarEventForm()
        return
      case 'openTeleworkRoom':
        await openTeleworkRoom()
        return
      case 'openTeleworkConfigure':
        await openTeleworkConfigure()
        return
      case 'openTeleworkAddRoom':
        await openTeleworkAddRoom()
    }
  }

  /** Mounts the module's production components with non-persistent demo data. */
  function openFallback (step: TourStep): void {
    closeDemonstration()
    usingDemo = true
    currentDemo = step.demo
    tutorialPopup = showPopup(
      GuidedTourDemoHost,
      { component: step.demoComponent, demo: step.demo },
      'top',
      undefined,
      undefined,
      { category: 'guided-tour-demo', overlay: false }
    )
  }

  /** Shows either the live target or its production-component demonstration. */
  async function showStep (index: number): Promise<boolean> {
    const request = ++presentationRequest
    panelStepIndex = index
    closeTourPanel()
    tutorialShield?.close()
    tutorialShield = undefined
    clearTarget()
    const step = steps[index]
    if (step === undefined) return false

    const keepSurface =
      step.surface === 'popup' && tutorialPopup !== undefined && (!usingDemo || currentDemo === step.demo)
    if (!keepSurface) closeDemonstration()

    let nextTarget: HTMLElement | undefined
    try {
      if (!keepSurface || step.action !== undefined) await runStepAction(step)
      nextTarget = await findTarget(step.selector)
    } catch {
      nextTarget = undefined
    }
    if (request !== presentationRequest) return false

    if (nextTarget === undefined) {
      openFallback(step)
      const demoRoot = await findTarget('.guided-tour-demo')
      nextTarget =
        demoRoot === undefined
          ? undefined
          : ((await findTarget(step.selector, demoRoot)) ??
            demoRoot.querySelector<HTMLElement>('[data-tutorial="guided-tour-demo-target"]') ??
            demoRoot)
    } else {
      usingDemo = false
      currentDemo = undefined
    }
    if (request !== presentationRequest || nextTarget === undefined) return false

    await frameTarget(nextTarget)
    openInteractionShield()
    return true
  }

  /** Shows a step and restores controls above its surface. */
  async function presentStep (index: number): Promise<boolean> {
    const shown = await showStep(index)
    openTourPanel()
    return shown
  }

  /** Creates the central status record once when connectivity permits. */
  async function ensurePreference (currentStep: number): Promise<Ref<GuidedTourPreference>> {
    if (preferenceId !== undefined) return preferenceId
    if (createPreferencePromise !== undefined) return await createPreferencePromise
    createPreferencePromise = client.createDoc(guidedTourPreferenceClass, core.space.Workspace, {
      attachedTo: account.uuid,
      currentStep
    })
    try {
      preferenceId = await createPreferencePromise
      return preferenceId
    } finally {
      createPreferencePromise = undefined
    }
  }

  /** Writes progress locally first and schedules remote synchronization. */
  function saveProgress (currentStep: number, activated = false, completed = false): void {
    const now = Date.now()
    localProgress = {
      currentStep,
      activatedOn: localProgress?.activatedOn ?? savedPreference?.activatedOn ?? (activated ? now : undefined),
      completedOn: localProgress?.completedOn ?? savedPreference?.completedOn ?? (completed ? now : undefined),
      pendingSync: true,
      updatedOn: now
    }
    writeGuidedTourProgress(progressStorage, storageKey, localProgress)
    void syncLocalProgress()
  }

  /** Synchronizes the newest local snapshot without blocking tutorial navigation. */
  async function syncLocalProgress (): Promise<void> {
    if (!supportsRemoteProgress || syncPromise !== undefined || localProgress?.pendingSync !== true) return
    const snapshot = localProgress
    syncPromise = (async () => {
      try {
        const id = await ensurePreference(snapshot.currentStep)
        await client.updateDoc(guidedTourPreferenceClass, core.space.Workspace, id, {
          currentStep: snapshot.currentStep,
          ...(snapshot.activatedOn !== undefined ? { activatedOn: snapshot.activatedOn } : {}),
          ...(snapshot.completedOn !== undefined ? { completedOn: snapshot.completedOn } : {})
        })
        if (localProgress?.updatedOn === snapshot.updatedOn) {
          localProgress = { ...snapshot, pendingSync: false }
          writeGuidedTourProgress(progressStorage, storageKey, localProgress)
        }
      } catch {
        // Local progress remains pending and is retried on the next query or interaction.
      }
    })()
    await syncPromise
    syncPromise = undefined
    if (localProgress?.pendingSync && localProgress.updatedOn !== snapshot.updatedOn) void syncLocalProgress()
  }

  /** Activates immediately; backend persistence continues in the background. */
  function startTour (): void {
    if (saving) return
    saveProgress(0, true)
    openTour(0)
  }

  /** Advances only after a live or fallback production surface is ready. */
  async function next (): Promise<void> {
    if (saving) return
    if (panelStepIndex === steps.length - 1) {
      saveProgress(panelStepIndex, true, true)
      closeTourPanel()
      closeDemonstration()
      clearTarget()
      active = false
      phase = 'completed'
      return
    }
    saving = true
    const nextStep = panelStepIndex + 1
    const shown = await showStep(nextStep)
    if (shown) {
      stepIndex = nextStep
      saveProgress(nextStep, true)
    }
    saving = false
    openTourPanel()
  }

  /** Moves backwards through the same live-or-demo rendering contract. */
  async function previous (): Promise<void> {
    if (saving || panelStepIndex === 0) return
    saving = true
    const previousStep = panelStepIndex - 1
    const shown = await showStep(previousStep)
    if (shown) {
      stepIndex = previousStep
      saveProgress(previousStep, true)
    }
    saving = false
    openTourPanel()
  }

  const handleOnline = (): void => { void syncLocalProgress() }

  window.addEventListener('resize', scheduleGeometryUpdate)
  window.addEventListener('scroll', scheduleGeometryUpdate, true)
  window.addEventListener('online', handleOnline)

  onDestroy(() => {
    clearTimeout(startupTimer)
    if (geometryFrame !== undefined) cancelAnimationFrame(geometryFrame)
    closeTourPanel()
    closeDemonstration()
    clearTarget()
    unsubscribeTour()
    unsubscribeLocation()
    window.removeEventListener('resize', scheduleGeometryUpdate)
    window.removeEventListener('scroll', scheduleGeometryUpdate, true)
    window.removeEventListener('online', handleOnline)
  })

  /** Returns browser storage when permitted; unavailable storage must not block the tour. */
  function getProgressStorage (): Storage | undefined {
    try {
      return window.localStorage
    } catch {
      return undefined
    }
  }
</script>
