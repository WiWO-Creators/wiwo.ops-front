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
  import { AccountRole, getCurrentAccount, hasAccountRole, Ref, WithLookup } from '@hcengineering/core'
  import { Floor, Room } from '@hcengineering/love'
  import { Component, DropdownLabels, Header, IconEdit, ModernButton } from '@hcengineering/ui'
  import { Viewlet, ViewletPreference } from '@hcengineering/view'
  import { ViewletSelector } from '@hcengineering/view-resources'
  import { createEventDispatcher } from 'svelte'

  import lovePlg from '../plugin'
  import { floors, selectedFloor } from '../stores'
  import RoomPreview from './RoomPreview.svelte'

  export let rooms: Room[] = []
  export let floor: Ref<Floor>
  export let tutorialFloor: Floor | undefined = undefined

  const dispatch = createEventDispatcher()

  let viewlet: WithLookup<Viewlet> | undefined
  let preference: ViewletPreference | undefined
  let loading = false

  let availableFloors: Floor[] = []
  $: availableFloors = tutorialFloor === undefined ? $floors : [tutorialFloor]
  let selected: Floor | undefined
  $: selected = availableFloors.filter((fl) => fl._id === floor)[0]

  const me = getCurrentAccount()

  let editable: boolean = false
  $: editable = tutorialFloor !== undefined || hasAccountRole(me, AccountRole.Maintainer)

  let items: Array<{ id: Ref<Floor>, label: string }> = []
  $: items = availableFloors.map((p) => {
    return { id: p._id, label: p.name }
  })

  function changeFloor (event: CustomEvent<Ref<Floor>>): void {
    if (event.detail) {
      selectedFloor.set(event.detail)
    }
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <span data-tutorial="telework-floor-selector">
      <DropdownLabels
        {items}
        selected={selected?._id}
        size={'large'}
        kind={'ghost'}
        enableSearch={false}
        autoSelect={false}
        on:selected={changeFloor}
      />
    </span>
    <svelte:fragment slot="beforeTitle">
      {#if tutorialFloor === undefined}
        <ViewletSelector bind:viewlet bind:preference bind:loading viewletQuery={{ attachTo: lovePlg.class.Floor }} />
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="actions">
      {#if editable}
        <span data-tutorial="telework-edit-office">
          <ModernButton
            icon={IconEdit}
            label={lovePlg.string.EditOffice}
            size={'small'}
            on:click={() => dispatch('configure')}
          />
        </span>
      {/if}
    </svelte:fragment>
  </Header>
  <div class="hulyComponent-content__column content" data-tutorial="telework-rooms">
    {#if tutorialFloor !== undefined}
      <div class="tutorial-floor-grid">
        {#each rooms as room}
          <RoomPreview {room} info={[]} />
        {/each}
      </div>
    {:else if viewlet?.$lookup?.descriptor?.component}
      <Component is={viewlet.$lookup.descriptor.component} props={{ floor, rooms }} on:open />
    {/if}
  </div>
</div>

<style lang="scss">
  .tutorial-floor-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(3rem, 1fr));
    grid-template-rows: repeat(3, minmax(3rem, 1fr));
    min-height: 14rem;
    padding: 1rem;
  }
</style>
