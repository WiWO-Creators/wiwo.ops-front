<script lang="ts">
  export let spotlight: { top: number, left: number, width: number, height: number }

  /** Prevents closing the demonstration modal while its tutorial step is active. */
  export function canClose (): boolean {
    return false
  }
</script>

<div class="guided-tour-shield" aria-hidden="true">
  <div
    class="guided-tour-spotlight"
    style:top={`${spotlight.top}px`}
    style:left={`${spotlight.left}px`}
    style:width={`${spotlight.width}px`}
    style:height={`${spotlight.height}px`}
  />
</div>

<style lang="scss">
  .guided-tour-shield { width: 0; height: 0; }
  .guided-tour-spotlight { position: fixed; pointer-events: none; border: 2px solid var(--button-primary-BackgroundColor); border-radius: 0.625rem; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.58); transition: all 0.18s var(--timing-main); }
</style>
