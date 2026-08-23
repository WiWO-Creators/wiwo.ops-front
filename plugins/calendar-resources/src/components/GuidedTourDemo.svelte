<script lang="ts">
  import CalendarNavigation from './CalendarNavigation.svelte'
  import CreateEvent from './CreateEvent.svelte'
  import { CalendarMode } from '../index'
  import calendar from '../plugin'

  export let demo: string

  const navigationItems = [
    { id: 'day', label: calendar.string.ModeDay, mode: CalendarMode.Day },
    { id: 'week', label: calendar.string.ModeWeek, mode: CalendarMode.Week },
    { id: 'month', label: calendar.string.ModeMonth, mode: CalendarMode.Month }
  ]
</script>

<div class="guided-tour-calendar-demo">
  {#if demo === 'calendar-navigation'}
    <CalendarNavigation
      ddItems={navigationItems}
      mode={CalendarMode.Week}
      onToday={() => {}}
      onBack={() => {}}
      onForward={() => {}}
    />
  {:else}
    <CreateEvent title="Ejemplo: reunión de equipo" />
  {/if}
</div>

<style lang="scss">
  .guided-tour-calendar-demo {
    min-width: min(44rem, calc(100vw - 4rem));
    min-height: 5rem;
    padding: 1rem;
  }
</style>
