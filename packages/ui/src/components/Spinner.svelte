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
  import type { ButtonSize } from '../types'
  import ThinkingOrb from './ThinkingOrb.svelte'

  export let size: ButtonSize = 'medium'
</script>

<div class="spinner spinner-{size}">
  <ThinkingOrb {size} />
</div>

<style lang="scss">
  .spinner {
    &-inline {
      width: 0.75rem;
      height: 0.75rem;
    }
    // 'x-small' existe en ButtonSize pero upstream nunca le dio medida: sin regla, la caja quedaba en cero.
    &-x-small {
      width: 0.875rem;
      height: 0.875rem;
    }
    &-small {
      width: 1rem;
      height: 1rem;
    }
    &-medium {
      width: 1.5rem;
      height: 1.5rem;
    }
    &-large {
      width: 2rem;
      height: 2rem;
    }
    &-x-large {
      width: 3rem;
      height: 3rem;
    }
  }
</style>
