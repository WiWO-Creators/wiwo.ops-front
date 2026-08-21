<script lang="ts">
  import activity, { type ActivityMessage } from '@hcengineering/activity'
  import contact, { getName, type Person } from '@hcengineering/contact'
  import { EmployeePresenter, getPersonByPersonIdCb } from '@hcengineering/contact-resources'
  import { AccountRole, getCurrentAccount, hasAccountRole, SortingOrder, type PersonId, type WithLookup } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Spinner } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'

  import type { ActiveTaskTimer, ControlCenterNavigation, Issue } from '@hcengineering/tracker'
  import ActivityMessagePresenter from '@hcengineering/activity-resources/src/components/activity-message/ActivityMessagePresenter.svelte'
  import tracker from '../plugin'

  const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
  const allowed = hasAccountRole(getCurrentAccount(), AccountRole.Maintainer)
  const client = getClient()
  const clientNow = Date.now()
  const since = clientNow - RETENTION_MS
  const timersQuery = createQuery()
  const activityQuery = createQuery()
  const navigationQuery = createQuery()

  let timers: WithLookup<ActiveTaskTimer>[] = []
  let messages: ActivityMessage[] = []
  let navigations: ControlCenterNavigation[] = []
  let feed: Array<{ kind: 'activity', value: ActivityMessage } | { kind: 'navigation', value: ControlCenterNavigation }> = []
  let actorNames = new Map<PersonId, string>()
  let now = clientNow
  let refreshTimer: ReturnType<typeof setInterval> | undefined

  $: if (allowed) {
    timersQuery.query(
      tracker.class.ActiveTaskTimer,
      {},
      (result) => {
        timers = result as WithLookup<ActiveTaskTimer>[]
      },
      {
        lookup: { attachedTo: tracker.class.Issue, employee: contact.mixin.Employee },
        sort: { startedOn: SortingOrder.Ascending }
      }
    )
    activityQuery.query(
      activity.class.ActivityMessage,
      { createdOn: { $gte: since } },
      (result) => {
        messages = result
      },
      { sort: { createdOn: SortingOrder.Descending }, limit: 30 }
    )
    navigationQuery.query(
      tracker.class.ControlCenterNavigation,
      { createdOn: { $gte: since } },
      (result) => {
        navigations = result
      },
      { sort: { createdOn: SortingOrder.Descending }, limit: 30 }
    )
  }

  $: feed = [
    ...messages.map((value) => ({ kind: 'activity' as const, value })),
    ...navigations.map((value) => ({ kind: 'navigation' as const, value }))
  ].sort((left, right) => right.value.createdOn - left.value.createdOn)

  $: for (const navigation of navigations) {
    if (!actorNames.has(navigation.createdBy)) loadActorName(navigation.createdBy)
  }

  onMount(() => {
    if (allowed) void removeExpiredNavigationEvents()
    refreshTimer = setInterval(() => {
      now = Date.now()
    }, 1_000)
  })

  onDestroy(() => {
    if (refreshTimer !== undefined) clearInterval(refreshTimer)
  })

  /** Formats a timer duration without creating a dependency on a custom formatter. */
  function elapsed (startedOn: number): string {
    const minutes = Math.max(0, Math.floor((now - startedOn) / 60_000))
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
  }

  function issueTitle (timer: WithLookup<ActiveTaskTimer>): string {
    const issue = timer.$lookup?.attachedTo as Issue | undefined
    return issue === undefined ? 'Proceso sin acceso' : `${issue.identifier} · ${issue.title}`
  }

  /** Resolves the platform person id used by transaction metadata into a display name. */
  function loadActorName (personId: PersonId): void {
    getPersonByPersonIdCb(personId, (person: Readonly<Person> | null) => {
      if (person === null) return
      actorNames = new Map(actorNames).set(personId, getName(client.getHierarchy(), person))
    })
  }

  function actorName (personId: PersonId): string {
    return actorNames.get(personId) ?? 'Usuario'
  }

  /** Removes navigation records that exceed the control center's 30-day retention period. */
  async function removeExpiredNavigationEvents (): Promise<void> {
    const expired = await client.findAll<ControlCenterNavigation>(tracker.class.ControlCenterNavigation, {
      createdOn: { $lt: since }
    })
    await Promise.all(expired.map(async (event) => await client.remove(event)))
  }
</script>

{#if !allowed}
  <div class="control-center-empty">Acceso restringido.</div>
{:else}
  <section class="control-center">
    <header>
      <div>
        <p class="eyebrow">OPERACIÓN EN VIVO</p>
        <h1>Centro de control</h1>
        <p class="subtitle">Actividad reciente y timers de todo el espacio.</p>
      </div>
      <div class="live"><span></span> En vivo</div>
    </header>

    <div class="summary">
      <div class="summary-card"><strong>{timers.length}</strong><span>timers activos</span></div>
      <div class="summary-card"><strong>{messages.length}</strong><span>acciones recientes</span></div>
      <div class="summary-card"><strong>{navigations.length}</strong><span>vistas abiertas</span></div>
    </div>

    <div class="grid">
      <section class="timers">
        <div class="section-title"><h2>Personas trabajando</h2><span>{timers.length} activas</span></div>
        {#if timers.length === 0}
          <div class="empty">No hay timers activos.</div>
        {:else}
          <div class="timer-list">
            {#each timers as timer (timer._id)}
              <article class="timer-card">
                <div class="timer-person"><EmployeePresenter value={timer.employee} avatarSize={'small'} showStatus /></div>
                <strong>{elapsed(timer.startedOn)}</strong>
                <p>{issueTitle(timer)}</p>
              </article>
            {/each}
          </div>
        {/if}
      </section>

      <section class="feed">
        <div class="section-title"><h2>Registro operativo</h2><span>últimos 30 días</span></div>
        {#if feed.length === 0}
          <div class="empty"><Spinner size={'small'} /> Cargando actividad…</div>
        {:else}
          {#each feed as event (event.value._id)}
            {#if event.kind === 'navigation'}
              <article class="navigation-event"><b>{actorName(event.value.createdBy)} abrió una vista</b><span>{event.value.path}</span></article>
            {:else}
              <ActivityMessagePresenter value={event.value} compact withActions={false} hideFooter />
            {/if}
          {/each}
        {/if}
      </section>
    </div>
  </section>
{/if}

<style lang="scss">
  .control-center { padding: 2rem; max-width: 96rem; margin: 0 auto; }
  header, .section-title, .live, .summary { display: flex; align-items: center; }
  header, .section-title { justify-content: space-between; gap: 1rem; }
  h1, h2, p { margin: 0; }
  h1 { font-size: 2rem; letter-spacing: -0.04em; }
  h2 { font-size: 1rem; }
  .eyebrow { color: var(--accent-color); font-size: .72rem; font-weight: 700; letter-spacing: .1em; }
  .subtitle, .section-title span, .summary-card span, .timer-card p, .navigation-event span { color: var(--caption-color); }
  .subtitle { margin-top: .35rem; }
  .live { color: var(--caption-color); font-size: .8rem; gap: .4rem; }
  .live span { width: .55rem; height: .55rem; border-radius: 50%; background: var(--accent-color); box-shadow: 0 0 0 .22rem color-mix(in srgb, var(--accent-color), transparent 75%); }
  .summary { gap: 1rem; margin: 2rem 0; flex-wrap: wrap; }
  .summary-card { min-width: 10rem; padding: 1rem 1.15rem; border: 1px solid var(--theme-divider-color); border-radius: .8rem; background: var(--theme-bg-color); display: grid; gap: .15rem; }
  .summary-card strong { font-size: 1.55rem; }
  .summary-card span { font-size: .8rem; }
  .grid { display: grid; grid-template-columns: minmax(18rem, .85fr) minmax(26rem, 1.5fr); gap: 1.5rem; align-items: start; }
  .timers, .feed { border: 1px solid var(--theme-divider-color); border-radius: 1rem; background: var(--theme-bg-color); overflow: hidden; }
  .section-title { padding: 1rem 1.15rem; border-bottom: 1px solid var(--theme-divider-color); }
  .section-title span { font-size: .78rem; }
  .timer-list { display: grid; gap: .75rem; padding: .75rem; }
  .timer-card { padding: .9rem; border-radius: .7rem; background: var(--theme-raw-color); display: grid; gap: .35rem; }
  .timer-person { min-width: 0; }
  .timer-card strong { color: var(--accent-color); font-variant-numeric: tabular-nums; }
  .timer-card p, .navigation-event span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .82rem; }
  .navigation-event { padding: .8rem 1rem; border-bottom: 1px solid var(--theme-divider-color); display: grid; gap: .2rem; font-size: .85rem; }
  .empty, .control-center-empty { padding: 2rem; color: var(--caption-color); display: flex; align-items: center; gap: .5rem; justify-content: center; }
  @media (max-width: 760px) { .control-center { padding: 1rem; } .grid { grid-template-columns: 1fr; } header { align-items: flex-start; } }
</style>
