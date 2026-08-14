<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { MasterTag } from '@hcengineering/card'
  import core, { generateId, Ref } from '@hcengineering/core'
  import { setPlatformStatus, Severity, Status, translate, unknownError } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Process, State } from '@hcengineering/process'
  import { makeRank } from '@hcengineering/rank'
  import {
    ButtonIcon,
    getCurrentLocation,
    Icon,
    IconAdd,
    IconFile,
    Label,
    navigate,
    showPopup
  } from '@hcengineering/ui'
  import { getRequiredSlots, importProcess } from '../exporter'
  import process from '../plugin'
  import ImportSlotsPopup from './settings/ImportSlotsPopup.svelte'

  export let masterTag: MasterTag

  const client = getClient()

  /**
   * Crea una automatización vacía y abre su editor.
   *
   * Los tres documentos (Process, State inicial y Transition de arranque) son un único flujo: una
   * automatización sin transición inicial se ejecuta sin avisar de nada, así que si falla cualquiera
   * de los pasos posteriores se borra el Process ya creado y el servidor arrastra en cascada sus
   * estados y transiciones (OnProcessRemove).
   *
   * No lanza: cualquier fallo se reporta al usuario como estado de plataforma.
   */
  async function add (): Promise<void> {
    const initState = generateId<State>()
    let id: Ref<Process> | undefined
    try {
      id = await client.createDoc(process.class.Process, core.space.Model, {
        name: await translate(process.string.NewProcess, {}),
        masterTag: masterTag._id,
        context: {},
        description: ''
      })
      await client.createDoc(
        process.class.State,
        core.space.Model,
        {
          process: id,
          rank: makeRank(undefined, undefined),
          title: await translate(process.string.NewState, {})
        },
        initState
      )
      await client.createDoc(process.class.Transition, core.space.Model, {
        process: id,
        from: null,
        to: initState,
        trigger: process.trigger.OnExecutionStart,
        rank: makeRank(undefined, undefined),
        actions: [],
        triggerParams: {}
      })
      handleSelect(id)
    } catch (err: any) {
      await setPlatformStatus(
        new Status(Severity.ERROR, process.string.CreateProcessError, { error: err?.message ?? String(err) })
      )
      if (id !== undefined) {
        await client.removeDoc(process.class.Process, core.space.Model, id).catch(async (cleanupErr: any) => {
          await setPlatformStatus(unknownError(cleanupErr))
        })
      }
    }
  }

  let processes: Process[] = []

  const query = createQuery()

  query.query(
    process.class.Process,
    {
      masterTag: masterTag._id
    },
    (res) => {
      processes = res
    }
  )

  function handleSelect (id: Ref<Process>): void {
    const loc = getCurrentLocation()
    loc.path[5] = process.component.ProcessEditor
    loc.path[6] = id
    navigate(loc, true)
  }

  function handleImport (): void {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (evt) => {
      const file = (evt.target as HTMLInputElement).files?.[0]
      if (file != null) {
        const text = await file.text()
        const slots = getRequiredSlots(text)
        if (slots && Object.keys(slots).length > 0) {
          showPopup(
            ImportSlotsPopup,
            { requiredSlots: slots, masterTag: masterTag._id },
            undefined,
            async (bindings) => {
              if (bindings) {
                await importProcess(masterTag._id, text, bindings)
              }
            }
          )
        } else {
          await importProcess(masterTag._id, text)
        }
      }
    }
    input.click()
  }
</script>

<div class="hulyTableAttr-header font-medium-12">
  <Icon icon={process.icon.Process} size="small" />
  <span><Label label={process.string.Processes} /></span>
  <div class="flex-row-center flex-gap-1">
    <ButtonIcon
      kind="primary"
      icon={IconFile}
      size="small"
      tooltip={{ label: process.string.Import, direction: 'bottom' }}
      on:click={handleImport}
    />
    <ButtonIcon kind="primary" icon={IconAdd} size="small" dataId={'btnAdd'} on:click={add} />
  </div>
</div>
{#if processes.length}
  <div class="hulyTableAttr-content task">
    {#each processes as val}
      <button
        class="hulyTableAttr-content__row justify-start"
        on:click|stopPropagation={() => {
          handleSelect(val._id)
        }}
      >
        <div class="hulyTableAttr-content__row-label px-2 font-medium-14 cursor-pointer">
          {val.name}
        </div>
      </button>
    {/each}
  </div>
{/if}
