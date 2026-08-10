<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import { Label } from '@hcengineering/ui'

  import Providers from './Providers.svelte'
  import login from '../plugin'

  // Acceso con proveedores externos como accion principal, con el separador
  // hacia el formulario de correo. Si el backend no devuelve ningun proveedor
  // no se pinta nada: ni boton, ni separador, ni hueco.
  let hasProviders = false
</script>

<div class="providers" class:visible={hasProviders}>
  <Providers bind:hasProviders />
  {#if hasProviders}
    <div class="separator">
      <span><Label label={login.string.OrContinueWithEmail} /></span>
    </div>
  {/if}
</div>

<style lang="scss">
  .providers.visible {
    margin-bottom: 0.5rem;
  }

  .separator {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-top: 1.25rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);

    &::before,
    &::after {
      content: '';
      flex-grow: 1;
      height: 1px;
      background-color: var(--theme-divider-color);
    }
  }
</style>
