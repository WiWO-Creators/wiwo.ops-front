<script lang="ts">
  // El login siempre se pinta en tema oscuro (LoginApp fuerza `theme-dark`),
  // asi que el wordmark es siempre el crema: si conmutara con la preferencia
  // del usuario, en tema claro saldria el azul sobre fondo oscuro.
  import wordmarkDark from '../../../img/wordmark-dark.png'

  /** Altura del logotipo. El ancho se deduce de la proporcion (~4.4:1). */
  export let height: string = '1.75rem'
</script>

<img class="wiwo-wordmark" style:height src={wordmarkDark} alt="WiWO Ops" />

<style lang="scss">
  .wiwo-wordmark {
    display: block;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    flex-shrink: 0;
  }
</style>
