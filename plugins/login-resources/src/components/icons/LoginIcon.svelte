<script lang="ts">
  import { themeStore } from '@hcengineering/ui'
  // Wordmark "wiwo.Ops": crema para tema oscuro, azul para tema claro.
  import wordmarkDark from '../../../img/wordmark-dark.png'
  import wordmarkLight from '../../../img/wordmark-light.png'
</script>

<img class="wiwo-wordmark" src={$themeStore.dark ? wordmarkDark : wordmarkLight} alt="WiWO Ops" />

<style lang="scss">
  // El wordmark es apaisado (~4.4:1): se fija la altura y el ancho se deduce.
  .wiwo-wordmark {
    display: block;
    height: 1.75rem;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    flex-shrink: 0;
  }
</style>
