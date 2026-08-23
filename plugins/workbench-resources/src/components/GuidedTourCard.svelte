<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import type { TourCardAction, TourStep } from '../opsTour'
  import type { GuidedTourPhase } from '../guidedTourState'

  export let phase: GuidedTourPhase
  export let step: TourStep | undefined
  export let stepIndex: number
  export let stepsCount: number
  export let saving: boolean
  export let usingDemo: boolean

  const dispatch = createEventDispatcher<{ update: TourCardAction }>()
  let card: HTMLElement | undefined
  let nextButton: HTMLButtonElement | undefined

  /** Keeps the mandatory tutorial open when the popup manager receives Escape. */
  export function canClose (): boolean {
    return false
  }

  function emit (action: TourCardAction): void {
    if (!saving) dispatch('update', action)
  }

  /** Keeps keyboard focus on the scripted tour controls while a demo modal is protected. */
  function trapFocus (event: KeyboardEvent): void {
    if (event.key !== 'Tab' || card === undefined) return
    const buttons = Array.from(card.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onMount(() => {
    nextButton?.focus()
  })
</script>

<section bind:this={card} class="guided-tour-card" role="dialog" aria-labelledby="guided-tour-title" on:keydown={trapFocus}>
  {#if phase === 'activation'}
    <span class="guided-tour-step">Tutorial obligatorio</span>
    <h2 id="guided-tour-title">Conoce las funcionalidades de Ops</h2>
    <p>Verás cada funcionalidad activa y su recorrido principal sin crear datos de ejemplo.</p>
  {:else if step !== undefined}
    <span class="guided-tour-step">Paso {stepIndex + 1} de {stepsCount}</span>
    <h2 id="guided-tour-title">{step.title}</h2>
    {#if step.moduleLabel !== undefined}<p class="guided-tour-module"><Label label={step.moduleLabel} /></p>{/if}
    {#if usingDemo}<p class="guided-tour-demo-label">Vista de demostración</p>{/if}
    <p>{step.description}</p>
  {/if}
  <div class="guided-tour-actions">
    <div class="guided-tour-navigation">
      {#if phase === 'tour' && stepIndex > 0}<button type="button" disabled={saving} on:click={() => { emit('previous') }}>Anterior</button>{/if}
      <button
        type="button"
        class="guided-tour-next"
        bind:this={nextButton}
        disabled={saving}
        on:click={() => { emit(phase === 'activation' ? 'start' : 'next') }}
      >
        {saving
          ? 'Preparando…'
          : phase === 'activation'
            ? 'Comenzar'
            : stepIndex === stepsCount - 1
              ? 'Finalizar'
              : 'Siguiente'}
      </button>
    </div>
  </div>
</section>

<style lang="scss">
  .guided-tour-card { width: min(24rem, calc(100vw - 2rem)); padding: 1.25rem; color: var(--theme-content-color); background: var(--theme-popup-color); border: 1px solid var(--theme-button-border); border-radius: 0.75rem; box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.35); }
  .guided-tour-step, .guided-tour-module, .guided-tour-demo-label { color: var(--theme-dark-color); font-size: 0.8125rem; }
  h2 { margin: 0.5rem 0; font-size: 1.125rem; }
  p { margin: 0; line-height: 1.45; }
  .guided-tour-module { margin-bottom: 0.5rem; font-weight: 600; }
  .guided-tour-demo-label { width: fit-content; margin-bottom: 0.5rem; padding: 0.125rem 0.5rem; border: 1px solid var(--theme-button-border); border-radius: 999px; }
  .guided-tour-actions, .guided-tour-navigation { display: flex; align-items: center; gap: 0.5rem; }
  .guided-tour-actions { justify-content: space-between; margin-top: 1.25rem; }
  .guided-tour-navigation { margin-left: auto; }
  button { min-height: 2rem; padding: 0.375rem 0.75rem; color: var(--theme-content-color); background: transparent; border: 1px solid var(--theme-button-border); border-radius: 0.375rem; cursor: pointer; }
  .guided-tour-next { color: var(--primary-button-color); background: var(--button-primary-BackgroundColor); border-color: var(--button-primary-BackgroundColor); }
  button:focus-visible { outline: 2px solid var(--primary-button-outline); outline-offset: 2px; }
</style>
