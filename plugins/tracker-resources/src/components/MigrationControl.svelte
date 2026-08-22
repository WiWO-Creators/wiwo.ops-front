<script lang="ts">
  import { getMetadata } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import { onDestroy, onMount } from 'svelte'

  type StepStatus = 'pending' | 'running' | 'stopping' | 'cancelled' | 'failed' | 'succeeded'
  type RunStatus = 'waiting_confirmation' | StepStatus

  interface StageDescriptor {
    id: string
    label: string
    tables: string[]
  }

  interface Plan {
    workspaces: Array<{ env: string; workspace: string }>
    stages: StageDescriptor[]
    active: { runId: string; stepId: string } | null
  }

  interface RunStep {
    id: string
    environment: string
    workspace: string
    stage: string
    status: StepStatus
    startedAt?: string
    finishedAt?: string
    lastMessage?: string
    error?: string
  }

  interface MigrationRun {
    id: string
    createdAt: string
    createdBy: string
    dryRun: boolean
    status: RunStatus
    lastSequence: number
    steps: RunStep[]
  }

  interface LogEvent {
    sequence: number
    timestamp: string
    level: 'info' | 'warn' | 'error'
    environment: string
    workspace: string
    stage: string
    table?: string
    phase?: 'start' | 'finish' | 'error'
    message: string
  }

  const API = '/_perfex/api'
  const POLL_MS = 1_000
  const token = getMetadata(presentation.metadata.Token) ?? ''
  const statusLabels: Record<RunStatus, string> = {
    pending: 'Pendiente',
    running: 'Ejecutando',
    stopping: 'Deteniendo',
    cancelled: 'Detenida',
    failed: 'Falló',
    succeeded: 'Completada',
    waiting_confirmation: 'Esperando confirmación'
  }

  let plan: Plan | undefined
  let runs: MigrationRun[] = []
  let selectedRun: MigrationRun | undefined
  let selectedRunId = ''
  let events: LogEvent[] = []
  let error = ''
  let loading = true
  let actionPending = false
  let filterEnvironment = ''
  let filterStage = ''
  let filterLevel = ''
  let pollTimer: ReturnType<typeof setInterval> | undefined

  $: selectedStep = selectedRun?.steps.find(({ status }) => status === 'running' || status === 'stopping')
  $: nextStep =
    selectedRun?.steps.find(({ status }) => status === 'failed' || status === 'cancelled') ??
    selectedRun?.steps.find(({ status }) => status === 'pending')
  $: filteredEvents = events.filter(
    (event) =>
      (filterEnvironment === '' || event.environment === filterEnvironment) &&
      (filterStage === '' || event.stage === filterStage) &&
      (filterLevel === '' || event.level === filterLevel)
  )

  onMount(() => {
    void initialize()
    pollTimer = setInterval(() => void poll(), POLL_MS)
  })

  onDestroy(() => {
    if (pollTimer !== undefined) clearInterval(pollTimer)
  })

  /** Carga plan e historial y selecciona la corrida más reciente. */
  async function initialize(): Promise<void> {
    loading = true
    try {
      const [loadedPlan, loadedRuns] = await Promise.all([request<Plan>('/plan'), request<MigrationRun[]>('/runs')])
      plan = loadedPlan
      runs = loadedRuns
      if (runs.length > 0) await selectRun(runs[0].id)
    } catch (err: unknown) {
      error = errorMessage(err)
    } finally {
      loading = false
    }
  }

  /** Refresca corrida y eventos nuevos sin volver a descargar el historial completo. */
  async function poll(): Promise<void> {
    if (selectedRunId === '' || actionPending) return
    try {
      const [run, newEvents] = await Promise.all([
        request<MigrationRun>(`/runs/${selectedRunId}`),
        request<LogEvent[]>(
          `/runs/${selectedRunId}/events?after=${events.length === 0 ? 0 : events[events.length - 1].sequence}`
        )
      ])
      selectedRun = run
      runs = runs.map((item) => (item.id === run.id ? run : item))
      events = [...events, ...newEvents]
      plan = await request<Plan>('/plan')
      error = ''
    } catch (err: unknown) {
      error = errorMessage(err)
    }
  }

  /** Selecciona una corrida y reconstruye sus logs desde el primer evento. */
  async function selectRun(runId: string): Promise<void> {
    selectedRunId = runId
    filterEnvironment = ''
    filterStage = ''
    filterLevel = ''
    const [run, loadedEvents] = await Promise.all([
      request<MigrationRun>(`/runs/${runId}`),
      request<LogEvent[]>(`/runs/${runId}/events?after=0`)
    ])
    selectedRun = run
    events = loadedEvents
  }

  /** Crea una matriz completa; cada etapa seguirá requiriendo confirmación separada. */
  async function createRun(dryRun: boolean): Promise<void> {
    if (
      !dryRun &&
      !window.confirm('¿Crear una corrida REAL? Cada etapa todavía pedirá confirmación antes de escribir.')
    )
      return
    await perform(async () => {
      const run = await request<MigrationRun>('/runs', { method: 'POST', body: JSON.stringify({ dryRun }) })
      runs = [run, ...runs]
      await selectRun(run.id)
    })
  }

  /** Ejecuta o reintenta una sola celda de la matriz. */
  async function runStep(step: RunStep): Promise<void> {
    if (selectedRun === undefined) return
    const descriptor = stageDescriptor(step.stage)
    const tables = descriptor?.tables.join(', ') || 'sin tablas Perfex'
    const mode = selectedRun.dryRun ? 'simular' : 'EJECUTAR'
    if (!window.confirm(`¿${mode} “${descriptor?.label ?? step.stage}” en ${step.workspace}?\n\nFuentes: ${tables}`))
      return
    await perform(async () => {
      selectedRun = await request<MigrationRun>(
        `/runs/${selectedRun?.id}/steps/${encodeURIComponent(step.id)}/${step.status === 'pending' ? 'start' : 'retry'}`,
        { method: 'POST' }
      )
    })
  }

  /** Solicita salida cooperativa después del ítem que esté escribiéndose. */
  async function stopRun(): Promise<void> {
    if (
      selectedRun === undefined ||
      !window.confirm('¿Detener después del ítem activo? La etapa quedará reintentable.')
    )
      return
    await perform(async () => {
      selectedRun = await request<MigrationRun>(`/runs/${selectedRun?.id}/stop`, { method: 'POST' })
    })
  }

  /** Descarga el JSONL autenticado sin poner el token en la URL. */
  async function downloadLog(): Promise<void> {
    if (selectedRun === undefined) return
    await perform(async () => {
      const response = await fetch(`${API}/runs/${selectedRun?.id}/log`, { headers: authHeaders() })
      if (!response.ok) throw new Error(await responseError(response))
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = `perfex-migration-${selectedRun?.id}.jsonl`
      link.click()
      URL.revokeObjectURL(url)
    })
  }

  /** Centraliza estado y errores de acciones operativas. */
  async function perform(action: () => Promise<void>): Promise<void> {
    actionPending = true
    error = ''
    let succeeded = false
    try {
      await action()
      succeeded = true
    } catch (err: unknown) {
      error = errorMessage(err)
    } finally {
      actionPending = false
    }
    if (succeeded) await poll()
  }

  function stageDescriptor(stage: string): StageDescriptor | undefined {
    return plan?.stages.find(({ id }) => id === stage)
  }

  /** Extrae contadores emitidos por el importador para la barra de avance. */
  function progress(message: string | undefined): { done: number; total: number; percent: number } | undefined {
    const match = /\((\d+)\/(\d+),\s*(\d+)%\)/.exec(message ?? '')
    if (match === null) return undefined
    return { done: Number(match[1]), total: Number(match[2]), percent: Number(match[3]) }
  }

  /** Traduce estados persistidos a sus estilos semánticos. */
  function statusClass(status: RunStatus): string {
    if (status === 'succeeded') return 'positive'
    if (status === 'failed') return 'negative'
    if (status === 'running' || status === 'stopping') return 'active'
    return 'neutral'
  }

  /** Presenta timestamps del servidor en la zona local del operador. */
  function dateTime(value: string): string {
    return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value))
  }

  function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
  }

  function authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${token}` }
  }

  /** Ejecuta una petición autenticada y devuelve JSON tipado. */
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...authHeaders(), 'Content-Type': 'application/json', ...init.headers }
    })
    if (!response.ok) throw new Error(await responseError(response))
    return (await response.json()) as T
  }

  /** Extrae el error estructurado de una respuesta fallida. */
  async function responseError(response: Response): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as { error?: string }
    return body.error ?? `Error HTTP ${response.status}`
  }
</script>

<section class="migration-control">
  <header class="migration-header">
    <div>
      <p class="eyebrow">PERFEX → OPS</p>
      <h2>Migración controlada</h2>
      <p class="subtitle">Una etapa aislada por vez. Nada continúa sin tu confirmación.</p>
    </div>
    <div class="header-actions">
      <button type="button" class="button secondary" disabled={actionPending} on:click={() => createRun(true)}
        >Nueva simulación</button
      >
      <button type="button" class="button dangerous" disabled={actionPending} on:click={() => createRun(false)}
        >Nueva ejecución</button
      >
    </div>
  </header>

  {#if error !== ''}
    <div class="notice error" role="alert">{error}</div>
  {/if}

  {#if loading}
    <div class="empty">Cargando centro de migración…</div>
  {:else if plan === undefined}
    <div class="empty">Servicio de migración no disponible.</div>
  {:else if selectedRun === undefined}
    <div class="empty">No hay corridas. Empieza con una simulación completa.</div>
  {:else}
    <div class="run-bar">
      <label>
        <span>Historial</span>
        <select bind:value={selectedRunId} on:change={() => selectRun(selectedRunId)}>
          {#each runs as run (run.id)}
            <option value={run.id}
              >{dateTime(run.createdAt)} · {run.dryRun ? 'simulación' : 'real'} · {statusLabels[run.status]}</option
            >
          {/each}
        </select>
      </label>
      <div class="run-identity">
        <span class="status {statusClass(selectedRun.status)}">{statusLabels[selectedRun.status]}</span>
        <span>{selectedRun.createdBy}</span>
      </div>
      <div class="run-actions">
        <button type="button" class="button secondary" disabled={actionPending} on:click={downloadLog}
          >Descargar JSONL</button
        >
        {#if selectedStep !== undefined}
          <button
            type="button"
            class="button dangerous"
            disabled={actionPending || selectedStep.status === 'stopping'}
            on:click={stopRun}
          >
            {selectedStep.status === 'stopping' ? 'Deteniendo…' : 'Detener'}
          </button>
        {:else if nextStep !== undefined}
          <button
            type="button"
            class="button primary"
            disabled={actionPending || plan.active !== null}
            on:click={() => runStep(nextStep)}
          >
            {nextStep.status === 'pending' ? 'Continuar' : 'Reintentar fallo'}
          </button>
        {/if}
      </div>
    </div>

    <div class="workspace-grid">
      {#each plan.workspaces as workspace (workspace.env)}
        <section class="workspace-card">
          <div class="workspace-title">
            <div><span>WORKSPACE</span><strong>{workspace.workspace}</strong></div>
            <small
              >{selectedRun.steps.filter((step) => step.environment === workspace.env && step.status === 'succeeded')
                .length}/{selectedRun.steps.filter((step) => step.environment === workspace.env).length}</small
            >
          </div>
          <div class="step-list">
            {#each selectedRun.steps.filter((step) => step.environment === workspace.env) as step (step.id)}
              {@const descriptor = stageDescriptor(step.stage)}
              {@const currentProgress = progress(step.lastMessage)}
              <article class="step {step.status}">
                <div class="step-marker" aria-hidden="true"></div>
                <div class="step-body">
                  <div class="step-heading">
                    <strong>{descriptor?.label ?? step.stage}</strong>
                    <span class="status {statusClass(step.status)}">{statusLabels[step.status]}</span>
                  </div>
                  {#if currentProgress !== undefined}
                    <div class="progress" aria-label={`${currentProgress.done} de ${currentProgress.total}`}>
                      <span style={`width: ${currentProgress.percent}%`}></span>
                    </div>
                  {/if}
                  <p>{step.lastMessage ?? 'Sin ejecutar'}</p>
                  {#if descriptor !== undefined && descriptor.tables.length > 0}
                    <details>
                      <summary>{descriptor.tables.length} tablas fuente</summary>
                      <div class="table-list">
                        {#each descriptor.tables as table}<code>{table}</code>{/each}
                      </div>
                    </details>
                  {/if}
                </div>
                {#if step.status === 'pending' || step.status === 'failed' || step.status === 'cancelled'}
                  <button
                    type="button"
                    class="step-action"
                    disabled={actionPending || plan.active !== null}
                    on:click={() => runStep(step)}>{step.status === 'pending' ? 'Ejecutar' : 'Reintentar'}</button
                  >
                {/if}
              </article>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <section class="flight-recorder">
      <div class="recorder-header">
        <div>
          <span class="rec-dot"></span>
          <div>
            <h3>Registrador de vuelo</h3>
            <p>{events.length} eventos persistidos</p>
          </div>
        </div>
        <div class="filters">
          <select aria-label="Filtrar por workspace" bind:value={filterEnvironment}>
            <option value="">Todos los workspaces</option>
            {#each plan.workspaces as workspace}<option value={workspace.env}>{workspace.workspace}</option>{/each}
          </select>
          <select aria-label="Filtrar por etapa" bind:value={filterStage}>
            <option value="">Todas las etapas</option>
            {#each plan.stages as stage}<option value={stage.id}>{stage.label}</option>{/each}
          </select>
          <select aria-label="Filtrar por nivel" bind:value={filterLevel}>
            <option value="">Todos los niveles</option>
            <option value="info">Información</option>
            <option value="warn">Advertencias</option>
            <option value="error">Errores</option>
          </select>
        </div>
      </div>
      <div class="log" role="log" aria-live="polite">
        {#if filteredEvents.length === 0}
          <div class="log-empty">Sin eventos para estos filtros.</div>
        {:else}
          {#each filteredEvents as event (event.sequence)}
            <div class="log-line {event.level}">
              <time>{new Date(event.timestamp).toLocaleTimeString('es-CL')}</time>
              <b>{event.environment}/{event.stage}</b>
              {#if event.table !== undefined}<code>{event.table}</code>{/if}
              <span>{event.message}</span>
            </div>
          {/each}
        {/if}
      </div>
    </section>
  {/if}
</section>

<style lang="scss">
  .migration-control {
    display: grid;
    gap: 1.5rem;
  }
  .migration-header,
  .run-bar,
  .workspace-title,
  .step-heading,
  .recorder-header,
  .recorder-header > div,
  .header-actions,
  .run-actions,
  .run-identity {
    display: flex;
    align-items: center;
  }
  .migration-header,
  .workspace-title,
  .step-heading,
  .recorder-header {
    justify-content: space-between;
  }
  .migration-header {
    gap: 1.5rem;
  }
  h2,
  h3,
  p {
    margin: 0;
  }
  h2 {
    font-size: 1.75rem;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }
  h3 {
    font-size: 0.95rem;
  }
  .eyebrow,
  .workspace-title span {
    color: var(--accent-color);
    font-size: 0.68rem;
    font-weight: 700;
    letter-spacing: 0.11em;
  }
  .subtitle,
  .workspace-title small,
  .run-identity > span:last-child,
  .recorder-header p {
    color: var(--caption-color);
  }
  .subtitle {
    margin-top: 0.3rem;
    text-wrap: pretty;
  }
  .header-actions,
  .run-actions,
  .run-identity {
    gap: 0.5rem;
  }
  .button,
  .step-action {
    min-height: 2.5rem;
    border: 0;
    border-radius: 0.5rem;
    padding: 0 0.9rem;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 120ms cubic-bezier(0.23, 1, 0.32, 1),
      background-color 160ms cubic-bezier(0.23, 1, 0.32, 1);
  }
  .button:active:not(:disabled),
  .step-action:active:not(:disabled) {
    transform: scale(0.97);
  }
  .button:focus-visible,
  .step-action:focus-visible,
  select:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }
  .button:disabled,
  .step-action:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .button.primary {
    color: var(--theme-bg-color);
    background: var(--accent-color);
  }
  .button.secondary,
  .step-action {
    color: var(--theme-content-color);
    background: var(--theme-popup-hover);
  }
  .button.dangerous {
    color: var(--theme-on-error-color, #fff);
    background: var(--theme-error-color);
  }
  .notice {
    padding: 0.85rem 1rem;
    border-radius: 0.6rem;
  }
  .notice.error {
    color: var(--theme-state-negative-color);
    background: var(--theme-state-negative-background-color);
  }
  .run-bar {
    min-height: 3.5rem;
    gap: 1rem;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    background: var(--theme-bg-color);
  }
  .run-bar label {
    min-width: 18rem;
    display: grid;
    gap: 0.2rem;
  }
  .run-bar label span {
    color: var(--caption-color);
    font-size: 0.68rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .run-identity {
    min-width: 0;
    flex: 1;
  }
  select {
    min-height: 2.25rem;
    color: var(--theme-content-color);
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.45rem;
    padding: 0 0.65rem;
    background: var(--theme-raw-color);
    font: inherit;
  }
  .status {
    display: inline-flex;
    width: fit-content;
    align-items: center;
    min-height: 1.45rem;
    border-radius: 999px;
    padding: 0 0.5rem;
    font-size: 0.7rem;
    font-weight: 650;
    white-space: nowrap;
  }
  .status.positive {
    color: var(--theme-state-positive-color);
    background: var(--theme-state-positive-background-color);
  }
  .status.negative {
    color: var(--theme-state-negative-color);
    background: var(--theme-state-negative-background-color);
  }
  .status.active {
    color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color), transparent 88%);
  }
  .status.neutral {
    color: var(--caption-color);
    background: var(--theme-popup-hover);
  }
  .workspace-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .workspace-card {
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.8rem;
    background: var(--theme-bg-color);
  }
  .workspace-title {
    min-height: 3.5rem;
    padding: 0 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .workspace-title div {
    display: grid;
    gap: 0.15rem;
  }
  .workspace-title strong {
    font-size: 1rem;
  }
  .workspace-title small {
    font-variant-numeric: tabular-nums;
  }
  .step-list {
    padding: 0.35rem 0.75rem 0.75rem;
  }
  .step {
    position: relative;
    display: grid;
    grid-template-columns: 0.65rem minmax(0, 1fr) auto;
    gap: 0.65rem;
    align-items: start;
    min-height: 3.5rem;
    padding: 0.65rem 0.25rem;
    border-bottom: 1px solid color-mix(in srgb, var(--theme-divider-color), transparent 35%);
  }
  .step:last-child {
    border-bottom: 0;
  }
  .step-marker {
    width: 0.5rem;
    height: 0.5rem;
    margin-top: 0.38rem;
    border-radius: 50%;
    background: var(--theme-divider-color);
  }
  .step.running .step-marker,
  .step.stopping .step-marker {
    background: var(--accent-color);
    box-shadow: 0 0 0 0.2rem color-mix(in srgb, var(--accent-color), transparent 78%);
  }
  .step.failed .step-marker {
    background: var(--theme-state-negative-color);
  }
  .step.succeeded .step-marker {
    background: var(--theme-state-positive-color);
  }
  .step-body {
    min-width: 0;
    display: grid;
    gap: 0.3rem;
  }
  .step-heading {
    gap: 0.5rem;
  }
  .step-heading strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.84rem;
  }
  .step p {
    overflow: hidden;
    color: var(--caption-color);
    font-size: 0.75rem;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .step-action {
    min-height: 2rem;
    margin-top: 0.15rem;
    padding: 0 0.6rem;
    font-size: 0.72rem;
  }
  .progress {
    overflow: hidden;
    height: 0.2rem;
    border-radius: 999px;
    background: var(--theme-popup-hover);
  }
  .progress span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: var(--accent-color);
  }
  details {
    color: var(--caption-color);
    font-size: 0.7rem;
  }
  summary {
    width: fit-content;
    cursor: pointer;
  }
  .table-list {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    padding-top: 0.4rem;
  }
  code {
    border-radius: 0.3rem;
    padding: 0.12rem 0.35rem;
    color: var(--theme-content-color);
    background: var(--theme-popup-hover);
    font-size: 0.7rem;
  }
  .flight-recorder {
    overflow: hidden;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.8rem;
    background: var(--theme-bg-color);
  }
  .recorder-header {
    gap: 1rem;
    min-height: 4rem;
    padding: 0.65rem 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .recorder-header > div:first-child {
    gap: 0.65rem;
  }
  .recorder-header p {
    margin-top: 0.12rem;
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
  }
  .rec-dot {
    width: 0.65rem;
    height: 0.65rem;
    border-radius: 50%;
    background: var(--theme-state-negative-color);
    box-shadow: 0 0 0 0.2rem var(--theme-state-negative-background-color);
  }
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .filters select {
    min-height: 2rem;
    font-size: 0.75rem;
  }
  .log {
    max-height: 24rem;
    overflow: auto;
    padding: 0.5rem 0;
    background: color-mix(in srgb, var(--theme-raw-color), transparent 30%);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.72rem;
  }
  .log-line {
    display: grid;
    grid-template-columns: 5.5rem 8.5rem auto minmax(16rem, 1fr);
    gap: 0.6rem;
    align-items: baseline;
    min-height: 1.75rem;
    padding: 0.28rem 0.85rem;
  }
  .log-line:hover {
    background: var(--theme-popup-hover);
  }
  .log-line time {
    color: var(--caption-color);
    font-variant-numeric: tabular-nums;
  }
  .log-line b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .log-line.warn span {
    color: var(--theme-warning-color);
  }
  .log-line.error span {
    color: var(--theme-state-negative-color);
  }
  .log-empty,
  .empty {
    padding: 2rem;
    color: var(--caption-color);
    text-align: center;
  }
  @media (max-width: 900px) {
    .workspace-grid {
      grid-template-columns: 1fr;
    }
    .run-bar,
    .migration-header,
    .recorder-header {
      align-items: stretch;
      flex-direction: column;
    }
    .run-bar label {
      min-width: 0;
    }
    .run-actions,
    .header-actions {
      flex-wrap: wrap;
    }
    .log-line {
      grid-template-columns: 4.5rem 7rem minmax(12rem, 1fr);
    }
    .log-line code {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .button,
    .step-action {
      transition: none;
    }
  }
</style>
