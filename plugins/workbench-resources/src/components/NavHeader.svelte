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
  import type { IntlString } from '@hcengineering/platform'
  import { Label } from '@hcengineering/ui'
  // Logo de WiWO Ops, el mismo asset que usa la barra de aplicaciones.
  import wiwoIcon from '../../img/icon.png'

  export let label: IntlString
  export let withButton: boolean = false
  export let small: boolean = false
  export let showLogo: boolean = false
</script>

<div class="hulyNavPanel-header" class:withButton class:small>
  <span class="header-title">
    {#if showLogo}
      <img class="nav-logo" src={wiwoIcon} alt={'WiWO Ops'} />
    {/if}
    <span class="overflow-label"><Label {label} /></span>
  </span>
  <slot />
</div>

<style lang="scss">
  .header-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-1);
    min-width: 0;
  }
  .nav-logo {
    flex-shrink: 0;
    width: 1.5rem;
    height: 1.5rem;
    object-fit: contain;
    border-radius: 0.25rem;
  }
</style>
