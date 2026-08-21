<!--
// Copyright © 2020 Anticrm Platform Contributors.
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
  import type { Asset, IntlString } from '@hcengineering/platform'
  import type { AnySvelteComponent } from '@hcengineering/ui'
  import { Icon, Loading, tooltip } from '@hcengineering/ui'

  export let label: IntlString
  export let icon: Asset | AnySvelteComponent
  export let selected: boolean = false
  export let size: 'small' | 'medium' | 'large' = 'large'
  export let kind: 'default' | 'positive' | 'negative' | 'warning' | 'accented' | 'primary' = 'default'
  export let loading: boolean = false
  export let notify: boolean = false
  export let navigator: boolean = false
  export let dataId: string | undefined = undefined
</script>

<button
  class="app {size} {kind}"
  class:loading
  class:selected
  class:navigator
  id={'app-' + label}
  data-id={dataId}
  disabled={loading}
  use:tooltip={{ label }}
  on:click
>
  {#if loading}
    <Loading />
  {:else}
    <div class="flex-center icon-container" class:noty={notify}>
      <Icon {icon} size={size === 'small' ? 'small' : 'medium'} />
    </div>
    {#if notify}<div class="marker" />{/if}
  {/if}
</button>

<style lang="scss">
  .app {
    position: relative;
    flex-shrink: 0;
    padding: 0;
    background-color: transparent;
    border: 1px solid transparent;
    border-radius: 0.25rem;
    cursor: pointer;
    outline: none;
    transition:
      background-color var(--wiwo-motion-fast) var(--wiwo-ease-expressive),
      border-color var(--wiwo-motion-fast) var(--wiwo-ease-expressive);

    &.loading {
      pointer-events: none;
    }

    &.large {
      width: 2.25rem;
      height: 2.25rem;
    }
    &.medium {
      width: 2rem;
      height: 2rem;
    }
    &.small,
    &.small .icon-container {
      width: calc(var(--status-bar-normal-height) - 8px);
      height: calc(var(--status-bar-normal-height) - 8px);
      border-radius: 0.25rem;
    }
    &.small.selected {
      background-color: var(--theme-button-pressed);
    }

    .icon-container {
      width: 1.25rem;
      height: 1.25rem;
      color: var(--theme-navpanel-icons-color);
    }

    // El azul translucido tambien al pasar el mouse, mas tenue que el seleccionado.
    &:hover:not(.selected):not(.primary):not(.positive):not(.negative):not(.warning):not(.accented) {
      background-color: color-mix(in srgb, var(--wiwo-selected-BackgroundColor) 60%, transparent);
      border-color: color-mix(in srgb, var(--wiwo-selected-BorderColor) 45%, transparent);

      .icon-container {
        color: var(--wiwo-selected-IconColor);
      }
    }
    &:focus {
      box-shadow: 0 0 0 2px var(--primary-button-outline);
      .icon-container {
        color: var(--theme-caption-color);
      }
    }

    // Seleccionado al estilo WiwoLab: azul translucido y borde marcado, no un
    // gris lleno. El borde transparente de arriba evita el salto de layout.
    &.selected {
      background-color: var(--wiwo-selected-BackgroundColor);
      border-color: var(--wiwo-selected-BorderColor);
      .icon-container {
        color: var(--wiwo-selected-IconColor);
      }
    }
    &.navigator {
      border-color: var(--theme-button-border);
    }
    &.positive,
    &.positive.selected {
      background-color: var(--global-online-color);
    }
    &.negative,
    &.negative.selected {
      background-color: var(--button-negative-BackgroundColor);
    }
    &.warning,
    &.warning.selected {
      background-color: var(--theme-warning-color);
    }
    &.accented,
    &.accented.selected {
      background-color: var(--button-secondary-active-BackgroundColor);
    }
    &.primary {
      background-color: var(--button-primary-BackgroundColor);
    }
    &.primary.selected {
      background-color: var(--button-primary-active-BackgroundColor);
    }
    &.positive .icon-container,
    &.negative .icon-container,
    &.warning .icon-container,
    &.accented .icon-container,
    &.primary .icon-container {
      color: var(--primary-button-color);
    }
  }

  .marker {
    position: absolute;
    top: 1.1rem;
    right: 0.375rem;
    width: 0.425rem;
    height: 0.425rem;
    border-radius: 50%;
    background-color: var(--highlight-red);
  }
</style>
