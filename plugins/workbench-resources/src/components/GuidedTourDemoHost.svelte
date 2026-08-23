<script lang="ts">
  import { Component, type AnyComponent } from '@hcengineering/ui'

  export let component: AnyComponent
  export let demo: string

  /** Keeps the read-only demonstration mounted until the tutorial changes step. */
  export function canClose (): boolean {
    return false
  }
</script>

<section
  class="guided-tour-demo"
  data-tutorial="guided-tour-demo-target"
  aria-label="Vista de demostración del tutorial"
>
  <Component is={component} props={{ demo }} />
</section>

<style lang="scss">
  .guided-tour-demo {
    width: min(64rem, calc(100vw - 3rem));
    max-height: calc(100vh - 3rem);
    overflow: auto;
    color: var(--theme-content-color);
    background: var(--theme-popup-color);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.75rem;
  }
</style>
