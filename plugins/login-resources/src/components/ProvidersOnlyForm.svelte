<!--
// Copyright © 2024 Hardcore Engineering Inc.
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

  // Con el acceso local cerrado esta es la unica pantalla de entrada, asi que
  // tiene que sostenerse sola: titular propio y un estado vacio que explique
  // que pasa si el servidor no tiene ningun proveedor configurado.
  let hasProviders = false
</script>

<div class="providers-only">
  <h1 class="title"><Label label={login.string.LogIn} /></h1>
  <p class="hint"><Label label={login.string.SignInWithProvider} /></p>

  <Providers bind:hasProviders />

  {#if !hasProviders}
    <p class="empty"><Label label={login.string.NoProvidersConfigured} /></p>
  {/if}
</div>

<style lang="scss">
  .providers-only {
    display: flex;
    flex-direction: column;
  }
  .title {
    margin: 0;
    font-family: var(--font-brand);
    font-weight: 600;
    font-size: 1.5rem;
    letter-spacing: -0.015em;
    color: var(--theme-caption-color);
  }
  .hint {
    margin: 0.5rem 0 0;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--theme-content-color);
  }
  .empty {
    margin: 1rem 0 0;
    font-size: 0.8125rem;
    line-height: 1.5;
    color: var(--theme-dark-color);
  }
</style>
