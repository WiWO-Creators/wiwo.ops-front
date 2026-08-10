<!--
// Copyright © 2025 WiWO.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import type { ButtonSize } from '../types'

  /**
   * Thinking Orb de WiWO (neo.wiwo.me #thinking-orb) portado a CSS puro.
   * Es un elemento puramente decorativo: el texto accesible lo pone quien lo
   * envuelve (Loading.svelte ya expone la prop `label`).
   */
  export let size: ButtonSize = 'medium'
  export let state: 'thinking' | 'success' | 'error' = 'thinking'

  // ponytail: el nivel completo (backdrop-filter + caustics + particulas) solo
  // se activa en large/x-large. Con 20+ loaders simultaneos en una lista, el
  // backdrop-filter obliga al compositor a releer el fondo por instancia y
  // hunde el scroll; ademas, por debajo de 24px ninguna de esas capas se ve.
  // Via de mejora: si se mide que el navegador aguanta (o si se agrupan los
  // loaders detras de un unico contenedor con `contain: paint`), bajar el
  // umbral a 'medium' cambiando solo este set.
  const TAMANOS_DETALLE_COMPLETO: ButtonSize[] = ['large', 'x-large']

  $: detalleCompleto = TAMANOS_DETALLE_COMPLETO.includes(size)
</script>

<div class="wiwo-thinking-orb orb-{size}" class:detail-full={detalleCompleto} data-orb-state={state} aria-hidden="true">
  {#if detalleCompleto}
    <span class="orb-pulse" />
    <span class="orb-pulse" />
    <span class="orb-pulse" />
    <span class="orb-liquid-veil" />
    <span class="orb-caustic" />
    <span class="orb-light-field" />
    <span class="orb-aurora orb-aurora-one" />
    <span class="orb-aurora orb-aurora-two" />
    <span class="orb-aurora orb-aurora-three" />
  {/if}
  <span class="orb-rim" />
  {#if detalleCompleto}
    <span class="orb-core" />
    <span class="orb-glint" />
    <span class="orb-particle orb-particle-one" />
    <span class="orb-particle orb-particle-two" />
    <span class="orb-particle orb-particle-three" />
    <span class="orb-spark" style="--sx: 70%; --sy: 18%; --spark-scale: 0.02; --spark-speed: 5600ms; --spark-delay: -900ms;" />
    <span class="orb-spark" style="--sx: 25%; --sy: 72%; --spark-scale: 0.013; --spark-speed: 6800ms; --spark-delay: -2400ms;" />
    <span class="orb-spark" style="--sx: 79%; --sy: 68%; --spark-scale: 0.026; --spark-speed: 6200ms; --spark-delay: -1800ms;" />
  {/if}
</div>

<style lang="scss">
  .wiwo-thinking-orb {
    // Paleta: tokens Neo de packages/theme/styles/_vars.scss, hex solo como fallback.
    --orb-blue: var(--wiwo-blue, #4242ff);
    --orb-green: var(--wiwo-green, #3bff00);
    --orb-cream: var(--wiwo-beige, #f8fad7);
    --orb-purple: var(--wiwo-purple, #8d7cff);
    --orb-ease: var(--wiwo-ease-expressive, cubic-bezier(0.2, 0.8, 0.2, 1));

    // Derivados con alfa (color-mix evita duplicar los hex en cada capa).
    --orb-glow: color-mix(in srgb, var(--orb-blue) 38%, transparent);
    --orb-primary: color-mix(in srgb, var(--orb-blue) 58%, transparent);
    --orb-secondary: color-mix(in srgb, var(--orb-green) 50%, transparent);
    --orb-milk: color-mix(in srgb, var(--orb-cream) 48%, transparent);
    --orb-rim-color: color-mix(in srgb, var(--orb-cream) 64%, transparent);

    --orb-liquid-opacity: 0.62;
    --orb-caustic-opacity: 0.42;
    --orb-light-opacity: 0.86;
    --orb-aurora-opacity: 0.76;
    --orb-alpha: 0.9;
    --orb-speed: 4200ms;
    --orb-flow-speed: 6200ms;
    --orb-scale-a: 1;
    --orb-scale-b: 1.055;
    --orb-scale-c: 0.985;
    --orb-rotate-a: 0deg;
    --orb-rotate-b: 4deg;
    --orb-rotate-c: -3deg;

    position: relative;
    flex-shrink: 0;
    width: var(--orb-size);
    height: var(--orb-size);
    border-radius: 46% 54% 52% 48% / 48% 42% 58% 52%;
    border: 1px solid color-mix(in srgb, var(--orb-cream) 46%, transparent);
    background:
      radial-gradient(ellipse at 30% 22%, rgba(255, 255, 255, 0.74), rgba(255, 255, 255, 0.16) 28%, transparent 50%),
      radial-gradient(circle at 66% 34%, color-mix(in srgb, var(--orb-cream) 30%, transparent), transparent 24%),
      radial-gradient(circle at 74% 68%, color-mix(in srgb, var(--orb-green) 24%, transparent), transparent 34%),
      radial-gradient(circle at 30% 78%, var(--orb-primary), transparent 46%),
      conic-gradient(
        from 140deg,
        color-mix(in srgb, var(--orb-green) 50%, transparent),
        color-mix(in srgb, var(--orb-cream) 36%, transparent),
        var(--orb-primary),
        color-mix(in srgb, var(--orb-blue) 42%, transparent),
        color-mix(in srgb, var(--orb-green) 48%, transparent)
      ),
      linear-gradient(145deg, rgba(255, 255, 255, 0.24), rgba(255, 255, 255, 0.05));
    background-size: 128% 128%, 100% 100%, 118% 118%, 150% 150%, 220% 220%, 100% 100%;
    opacity: var(--orb-alpha);
    box-shadow:
      0 0 calc(var(--orb-size) * 0.4) var(--orb-glow),
      inset 0 2px calc(var(--orb-size) * 0.09) rgba(255, 255, 255, 0.58),
      inset -6% -8% calc(var(--orb-size) * 0.16) color-mix(in srgb, var(--orb-blue) 14%, transparent),
      inset 6% 7% calc(var(--orb-size) * 0.18) color-mix(in srgb, var(--orb-cream) 24%, transparent);
    transform: translateZ(0);
    animation:
      thinking-orb-breathe var(--orb-speed) var(--orb-ease) infinite,
      thinking-orb-glass-flow var(--orb-flow-speed) linear infinite;
  }

  // Todos los tamaños salen de --orb-size; el contrato es el de Spinner.svelte.
  .orb-inline {
    --orb-size: 0.75rem;
  }
  .orb-x-small {
    --orb-size: 0.875rem;
  }
  .orb-small {
    --orb-size: 1rem;
  }
  .orb-medium {
    --orb-size: 1.5rem;
  }
  .orb-large {
    --orb-size: 2rem;
  }
  .orb-x-large {
    --orb-size: 3rem;
  }

  // --- Estados -------------------------------------------------------------
  .wiwo-thinking-orb[data-orb-state='thinking'] {
    --orb-glow: color-mix(in srgb, var(--orb-blue) 56%, transparent);
    --orb-primary: color-mix(in srgb, var(--orb-blue) 82%, transparent);
    --orb-secondary: color-mix(in srgb, var(--orb-green) 68%, transparent);
    --orb-rim-color: color-mix(in srgb, var(--orb-cream) 78%, transparent);
    --orb-liquid-opacity: 0.78;
    --orb-caustic-opacity: 0.64;
    --orb-light-opacity: 0.9;
    --orb-aurora-opacity: 0.86;
    --orb-alpha: 0.84;
    --orb-speed: 3000ms;
    --orb-flow-speed: 4600ms;
    --orb-scale-a: 1.03;
    --orb-scale-b: 1.095;
    --orb-scale-c: 1;
    --orb-rotate-b: 6deg;
    --orb-rotate-c: -4deg;
    border-radius: 50% 50% 43% 57% / 45% 58% 42% 55%;
  }

  .wiwo-thinking-orb[data-orb-state='success'] {
    --orb-glow: color-mix(in srgb, var(--orb-green) 62%, transparent);
    --orb-primary: color-mix(in srgb, var(--orb-green) 86%, transparent);
    --orb-secondary: color-mix(in srgb, var(--orb-cream) 66%, transparent);
    --orb-rim-color: color-mix(in srgb, var(--orb-green) 92%, transparent);
    --orb-liquid-opacity: 0.72;
    --orb-caustic-opacity: 0.54;
    --orb-light-opacity: 0.94;
    --orb-aurora-opacity: 0.82;
    --orb-alpha: 0.88;
    --orb-speed: 2600ms;
    --orb-flow-speed: 3800ms;
    --orb-scale-b: 1.045;
    --orb-scale-c: 0.99;
    --orb-rotate-b: 2deg;
    --orb-rotate-c: -1deg;
    border-radius: 48% 52% 50% 50%;
  }

  // La página lo llama "retry": contracción fría, sin dramatizar.
  .wiwo-thinking-orb[data-orb-state='error'] {
    --orb-glow: color-mix(in srgb, var(--orb-cream) 20%, transparent);
    --orb-primary: color-mix(in srgb, var(--orb-purple) 58%, transparent);
    --orb-secondary: color-mix(in srgb, var(--orb-cream) 42%, transparent);
    --orb-rim-color: color-mix(in srgb, var(--orb-cream) 50%, transparent);
    --orb-liquid-opacity: 0.38;
    --orb-caustic-opacity: 0.26;
    --orb-light-opacity: 0.58;
    --orb-aurora-opacity: 0.36;
    --orb-alpha: 0.7;
    --orb-speed: 1700ms;
    --orb-flow-speed: 2400ms;
    --orb-scale-a: 0.9;
    --orb-scale-b: 0.955;
    --orb-scale-c: 0.865;
    --orb-rotate-a: -3deg;
    --orb-rotate-b: 4deg;
    --orb-rotate-c: -7deg;
    filter: saturate(0.72) brightness(0.86);
    border-radius: 52% 48% 48% 52% / 58% 44% 56% 42%;
  }

  // --- Capas exclusivas del nivel completo ---------------------------------
  .detail-full {
    -webkit-backdrop-filter: blur(22px) saturate(1.9);
    backdrop-filter: blur(22px) saturate(1.9);
  }

  .detail-full::before,
  .detail-full::after {
    content: '';
    position: absolute;
    inset: 10%;
    border-radius: inherit;
    pointer-events: none;
  }

  .detail-full::before {
    background:
      radial-gradient(circle at 30% 28%, rgba(255, 255, 255, 0.44), transparent 20%),
      radial-gradient(circle at 76% 68%, color-mix(in srgb, var(--orb-cream) 18%, transparent), transparent 22%),
      conic-gradient(
        from 120deg,
        transparent,
        color-mix(in srgb, var(--orb-cream) 26%, transparent),
        var(--orb-primary),
        transparent 68%
      );
    mix-blend-mode: screen;
    opacity: 0.78;
    animation: thinking-orb-liquid var(--orb-flow-speed) linear infinite;
  }

  .detail-full::after {
    inset: 2% 12% auto 14%;
    height: 38%;
    border-radius: 48% 52% 44% 56%;
    background:
      radial-gradient(ellipse at 32% 28%, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.24) 42%, transparent 72%),
      linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0.08) 70%, transparent);
    opacity: 0.64;
    transform: rotate(-10deg);
    animation: thinking-orb-sheen 4800ms var(--orb-ease) infinite alternate;
  }

  .orb-liquid-veil,
  .orb-light-field,
  .orb-caustic,
  .orb-rim,
  .orb-glint {
    position: absolute;
    border-radius: inherit;
    pointer-events: none;
  }

  .orb-liquid-veil {
    inset: 7%;
    z-index: 1;
    background:
      radial-gradient(ellipse at 28% 22%, rgba(255, 255, 255, 0.3), transparent 32%),
      radial-gradient(ellipse at 68% 72%, color-mix(in srgb, var(--orb-green) 18%, transparent), transparent 30%),
      conic-gradient(
        from 220deg,
        transparent,
        color-mix(in srgb, var(--orb-cream) 16%, transparent),
        var(--orb-primary),
        transparent 60%,
        var(--orb-secondary),
        transparent
      );
    filter: blur(calc(var(--orb-size) * 0.03)) saturate(1.16);
    mix-blend-mode: screen;
    opacity: var(--orb-liquid-opacity);
    animation: thinking-orb-viscosity 7200ms var(--orb-ease) infinite;
  }

  .orb-light-field {
    inset: 0;
    z-index: 2;
    background:
      radial-gradient(ellipse at 24% 18%, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.2) 27%, transparent 50%),
      radial-gradient(circle at 64% 46%, color-mix(in srgb, var(--orb-cream) 20%, transparent), transparent 20%),
      radial-gradient(circle at 82% 68%, rgba(255, 255, 255, 0.1), transparent 24%);
    mix-blend-mode: screen;
    opacity: var(--orb-light-opacity);
    animation: thinking-orb-light-swim 5400ms var(--orb-ease) infinite alternate;
  }

  .orb-caustic {
    inset: 4%;
    z-index: 2;
    background:
      repeating-conic-gradient(
        from 18deg,
        color-mix(in srgb, var(--orb-cream) 20%, transparent) 0deg 8deg,
        transparent 9deg 24deg
      ),
      radial-gradient(circle at 50% 50%, transparent 36%, rgba(255, 255, 255, 0.18), transparent 62%);
    filter: blur(calc(var(--orb-size) * 0.023));
    mix-blend-mode: screen;
    opacity: var(--orb-caustic-opacity);
    animation: thinking-orb-caustic 7600ms linear infinite;
  }

  .orb-aurora {
    position: absolute;
    inset: 8%;
    z-index: 3;
    border-radius: inherit;
    pointer-events: none;
    mix-blend-mode: screen;
    filter: blur(calc(var(--orb-size) * 0.06)) saturate(1.42);
    opacity: var(--orb-aurora-opacity);
    transform-origin: 50% 50%;
  }

  .orb-aurora-one {
    background: conic-gradient(
      from 210deg,
      transparent 0 18%,
      color-mix(in srgb, var(--orb-green) 52%, transparent),
      transparent 42%,
      color-mix(in srgb, var(--orb-blue) 48%, transparent),
      transparent 78% 100%
    );
    animation: orb-aurora-one 4800ms var(--orb-ease) infinite;
  }

  .orb-aurora-two {
    inset: 14%;
    background:
      radial-gradient(ellipse at 70% 38%, color-mix(in srgb, var(--orb-cream) 40%, transparent), transparent 34%),
      conic-gradient(
        from 24deg,
        transparent,
        color-mix(in srgb, var(--orb-blue) 54%, transparent),
        transparent 44%,
        color-mix(in srgb, var(--orb-green) 34%, transparent),
        transparent
      );
    animation: orb-aurora-two 6200ms linear infinite reverse;
    opacity: calc(var(--orb-aurora-opacity) * 0.82);
  }

  .orb-aurora-three {
    inset: 20%;
    background:
      radial-gradient(circle at 42% 58%, color-mix(in srgb, var(--orb-cream) 42%, transparent), transparent 28%),
      radial-gradient(circle at 62% 52%, color-mix(in srgb, var(--orb-green) 28%, transparent), transparent 34%),
      radial-gradient(circle at 48% 36%, color-mix(in srgb, var(--orb-blue) 38%, transparent), transparent 38%);
    animation: orb-aurora-three 3600ms var(--orb-ease) infinite alternate;
    opacity: calc(var(--orb-aurora-opacity) * 0.74);
  }

  // El rim existe en los dos niveles de detalle: es lo que da el borde vivo
  // cuando el orb mide 12px y no se distingue ninguna otra capa.
  .orb-rim {
    inset: -1px;
    z-index: 4;
    background: conic-gradient(
      from 0deg,
      color-mix(in srgb, var(--orb-cream) 8%, transparent),
      var(--orb-rim-color),
      color-mix(in srgb, var(--orb-blue) 28%, transparent),
      color-mix(in srgb, var(--orb-green) 42%, transparent),
      color-mix(in srgb, var(--orb-cream) 8%, transparent)
    );
    // Grosor del aro: 9% del tamaño con piso de 1.5px, si no a 12px no se ve.
    --orb-rim-width: max(1.5px, calc(var(--orb-size) * 0.09));
    -webkit-mask: radial-gradient(
      farthest-side,
      transparent calc(100% - var(--orb-rim-width)),
      #000 calc(100% - var(--orb-rim-width) + 1px)
    );
    mask: radial-gradient(
      farthest-side,
      transparent calc(100% - var(--orb-rim-width)),
      #000 calc(100% - var(--orb-rim-width) + 1px)
    );
    opacity: 0.72;
    animation: thinking-orb-rim 4200ms linear infinite;
  }

  .orb-core {
    position: absolute;
    inset: 42%;
    z-index: 5;
    border-radius: 50%;
    background: radial-gradient(
      circle at 42% 36%,
      rgba(255, 255, 255, 0.72),
      color-mix(in srgb, var(--orb-cream) 28%, transparent) 42%,
      transparent 74%
    );
    box-shadow:
      0 0 calc(var(--orb-size) * 0.12) color-mix(in srgb, var(--orb-cream) 54%, transparent),
      0 0 calc(var(--orb-size) * 0.28) color-mix(in srgb, var(--orb-green) 22%, transparent);
    animation: thinking-orb-core 1900ms var(--orb-ease) infinite;
  }

  .orb-glint {
    z-index: 6;
    width: 3.3%;
    height: 3.3%;
    right: 21%;
    top: 24%;
    border-radius: 50%;
    background: var(--orb-cream);
    box-shadow:
      0 0 calc(var(--orb-size) * 0.05) color-mix(in srgb, var(--orb-cream) 90%, transparent),
      0 0 calc(var(--orb-size) * 0.14) color-mix(in srgb, var(--orb-blue) 40%, transparent);
    opacity: 0.88;
    animation: thinking-orb-glint 2800ms var(--orb-ease) infinite;
  }

  .orb-pulse {
    position: absolute;
    inset: -18%;
    z-index: -1;
    border-radius: inherit;
    border: 1px solid color-mix(in srgb, var(--orb-green) 30%, transparent);
    background: radial-gradient(circle, rgba(255, 255, 255, 0.08), transparent 62%);
    animation: thinking-orb-pulse 2200ms var(--orb-ease) infinite;
  }

  .orb-pulse:nth-child(2) {
    animation-delay: 740ms;
    border-color: color-mix(in srgb, var(--orb-blue) 28%, transparent);
  }

  .orb-pulse:nth-child(3) {
    animation-delay: 1480ms;
    border-color: color-mix(in srgb, var(--orb-cream) 22%, transparent);
  }

  // Las partículas orbitan DENTRO de la caja (radio relativo a --orb-size)
  // para no desbordar el hueco reservado por Spinner en los 119 usos.
  .orb-particle {
    position: absolute;
    z-index: 4;
    left: 50%;
    top: 50%;
    width: 3%;
    height: 3%;
    border-radius: 50%;
    background: var(--orb-green);
    box-shadow: 0 0 calc(var(--orb-size) * 0.06) color-mix(in srgb, var(--orb-green) 74%, transparent);
    mix-blend-mode: screen;
    --orbit: calc(var(--orb-size) * 0.36);
    animation: thinking-orb-particle var(--speed, 5200ms) linear infinite;
  }

  .orb-particle-two {
    --orbit: calc(var(--orb-size) * 0.3);
    --speed: 6400ms;
    width: 2%;
    height: 2%;
    background: var(--orb-blue);
    animation-delay: -1900ms;
  }

  .orb-particle-three {
    --orbit: calc(var(--orb-size) * 0.44);
    --speed: 7800ms;
    width: 1.7%;
    height: 1.7%;
    background: var(--orb-cream);
    animation-delay: -3600ms;
  }

  .orb-spark {
    position: absolute;
    z-index: 5;
    left: var(--sx, 50%);
    top: var(--sy, 50%);
    width: calc(var(--orb-size) * var(--spark-scale, 0.017));
    height: calc(var(--orb-size) * var(--spark-scale, 0.017));
    border-radius: 50%;
    background: var(--orb-cream);
    box-shadow: 0 0 calc(var(--orb-size) * 0.05) color-mix(in srgb, var(--orb-cream) 72%, transparent);
    mix-blend-mode: screen;
    animation: thinking-orb-spark var(--spark-speed, 6200ms) var(--orb-ease) infinite;
    animation-delay: var(--spark-delay, 0ms);
  }

  // --- Animaciones ---------------------------------------------------------
  @keyframes thinking-orb-breathe {
    0%,
    100% {
      transform: scale(var(--orb-scale-a, 1)) rotate(var(--orb-rotate-a, 0deg));
      border-radius: 46% 54% 52% 48% / 48% 42% 58% 52%;
    }
    44% {
      transform: scale(var(--orb-scale-b, 1.055)) rotate(var(--orb-rotate-b, 4deg));
      border-radius: 52% 48% 45% 55% / 44% 55% 45% 56%;
    }
    72% {
      transform: scale(var(--orb-scale-c, 0.985)) rotate(var(--orb-rotate-c, -3deg));
      border-radius: 43% 57% 58% 42% / 54% 44% 56% 46%;
    }
  }

  @keyframes thinking-orb-glass-flow {
    0%,
    100% {
      background-position:
        0% 50%,
        12% 18%,
        88% 72%,
        18% 82%,
        0% 50%,
        50% 50%;
    }
    50% {
      background-position:
        0% 50%,
        22% 28%,
        74% 68%,
        44% 58%,
        100% 50%,
        50% 50%;
    }
  }

  @keyframes thinking-orb-liquid {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes thinking-orb-sheen {
    from {
      opacity: 0.46;
      transform: rotate(-12deg) translateY(0);
    }
    to {
      opacity: 0.82;
      transform: rotate(-5deg) translateY(10%);
    }
  }

  @keyframes thinking-orb-viscosity {
    0%,
    100% {
      transform: rotate(0deg) scale(1);
      border-radius: 44% 56% 52% 48% / 48% 44% 56% 52%;
    }
    46% {
      transform: rotate(156deg) scale(1.08);
      border-radius: 58% 42% 46% 54% / 43% 57% 45% 55%;
    }
    72% {
      transform: rotate(258deg) scale(0.96);
      border-radius: 42% 58% 60% 40% / 56% 42% 58% 44%;
    }
  }

  @keyframes thinking-orb-light-swim {
    0%,
    100% {
      transform: translate3d(-1%, -2%, 0) rotate(-4deg) scale(1);
      opacity: 0.58;
    }
    48% {
      transform: translate3d(4%, 7%, 0) rotate(7deg) scale(1.05);
      opacity: var(--orb-light-opacity);
    }
  }

  @keyframes thinking-orb-caustic {
    from {
      transform: rotate(0deg) scale(1);
    }
    to {
      transform: rotate(-360deg) scale(1.04);
    }
  }

  @keyframes orb-aurora-one {
    0%,
    100% {
      transform: rotate(0deg) scale(0.95) skew(-4deg);
      opacity: calc(var(--orb-aurora-opacity) * 0.7);
    }
    46% {
      transform: rotate(142deg) scale(1.16) skew(6deg);
      opacity: var(--orb-aurora-opacity);
    }
  }

  @keyframes orb-aurora-two {
    from {
      transform: rotate(0deg) scale(1);
    }
    to {
      transform: rotate(-360deg) scale(1.08);
    }
  }

  @keyframes orb-aurora-three {
    0% {
      transform: translate3d(-4%, 3%, 0) scale(0.94);
      opacity: calc(var(--orb-aurora-opacity) * 0.58);
    }
    100% {
      transform: translate3d(5%, -4%, 0) scale(1.14);
      opacity: calc(var(--orb-aurora-opacity) * 0.86);
    }
  }

  @keyframes thinking-orb-rim {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes thinking-orb-core {
    0%,
    100% {
      transform: scale(0.94);
      opacity: 0.78;
    }
    52% {
      transform: scale(1.12);
      opacity: 1;
    }
  }

  @keyframes thinking-orb-glint {
    0%,
    100% {
      transform: translate3d(0, 0, 0) scale(0.7);
      opacity: 0.18;
    }
    22%,
    46% {
      transform: translate3d(calc(var(--orb-size) * -0.073), calc(var(--orb-size) * 0.06), 0) scale(1.25);
      opacity: 0.92;
    }
    72% {
      transform: translate3d(calc(var(--orb-size) * -0.153), calc(var(--orb-size) * 0.16), 0) scale(0.82);
      opacity: 0.34;
    }
  }

  @keyframes thinking-orb-pulse {
    0% {
      opacity: 0.62;
      transform: scale(0.82);
    }
    72%,
    100% {
      opacity: 0;
      transform: scale(1.34);
    }
  }

  @keyframes thinking-orb-particle {
    from {
      transform: rotate(0deg) translateX(var(--orbit)) rotate(0deg);
    }
    to {
      transform: rotate(360deg) translateX(var(--orbit)) rotate(-360deg);
    }
  }

  @keyframes thinking-orb-spark {
    0%,
    100% {
      transform: translate3d(0, 0, 0) scale(0.72);
      opacity: 0.34;
    }
    38% {
      transform: translate3d(calc(var(--orb-size) * 0.06), calc(var(--orb-size) * -0.08), 0) scale(1.25);
      opacity: 0.88;
    }
    68% {
      transform: translate3d(calc(var(--orb-size) * -0.046), calc(var(--orb-size) * 0.06), 0) scale(0.9);
      opacity: 0.62;
    }
  }

  // --- Accesibilidad: el orb aparece en 119 pantallas, sin esto no se envía.
  @media (prefers-reduced-motion: reduce) {
    .wiwo-thinking-orb,
    .wiwo-thinking-orb::before,
    .wiwo-thinking-orb::after,
    .wiwo-thinking-orb span {
      animation: none !important;
      transition: none !important;
    }

    // Sin animación el orb queda quieto: se fija una forma legible y se sube
    // la opacidad para que siga leyéndose como indicador y no como mancha.
    .wiwo-thinking-orb {
      border-radius: 48% 52% 50% 50%;
      opacity: 1;
      transform: none;
    }

    // Las capas difusas sin movimiento solo emborronan: se apagan.
    .orb-liquid-veil,
    .orb-caustic,
    .orb-aurora {
      display: none;
    }
  }
</style>
