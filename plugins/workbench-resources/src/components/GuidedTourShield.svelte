<script lang="ts">
  /** Prevents closing the demonstration modal while its tutorial step is active. */
  export function canClose (): boolean {
    return false
  }
</script>

<div class="guided-tour-shield" aria-hidden="true"></div>

<style lang="scss">
  .guided-tour-shield { width: 0; height: 0; overflow: hidden; }
</style>
