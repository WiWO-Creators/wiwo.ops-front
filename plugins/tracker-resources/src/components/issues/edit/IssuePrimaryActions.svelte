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
  import { type Issue } from '@hcengineering/tracker'
  import {
    Button,
    type ButtonKind,
    type ButtonSize,
    closeTooltip,
    deviceOptionsStore as deviceInfo,
    showPopup
  } from '@hcengineering/ui'
  import { restrictionStore } from '@hcengineering/view-resources'

  import tracker from '../../../plugin'
  import AssigneeEditor from '../AssigneeEditor.svelte'
  import StatusEditor from '../StatusEditor.svelte'

  /**
   * Acciones primarias de una tarea, montadas en `tracker.extensions.EditIssueHeader`.
   *
   * Expone en la cabecera del panel de edición las tres escrituras más frecuentes sobre una tarea
   * —estado, asignado y crear subtarea— reusando los mismos editores y popups del panel lateral,
   * de modo que sigan disponibles cuando el aside se repliega en ventanas angostas.
   */

  /** Tarea en edición; la inyecta `EditIssue.svelte` como `value`. */
  export let value: Issue
  /** `effectiveReadonly` de la tarea: si es `true` no se ofrece ninguna acción. */
  export let readonly: boolean = false
  export let size: ButtonSize = 'medium'
  /** Peso visual de los controles secundarios. `EditIssue` inyecta `'ghost'`. */
  export let kind: ButtonKind = 'ghost'

  /** Ancho de documento por debajo del cual sólo caben estado y asignado. */
  const NARROW_WIDTH_PX = 600

  $: editable = value !== undefined && !readonly && !$restrictionStore.readonly
  $: showNewSubIssue = $deviceInfo.docWidth > NARROW_WIDTH_PX

  /**
   * Abre el diálogo de creación de tarea con la tarea actual como padre.
   * Equivale a la acción `NewSubIssue` del menú contextual y al botón de la sección Subtareas.
   */
  function createSubIssue (): void {
    closeTooltip()
    showPopup(
      tracker.component.CreateIssue,
      { space: value.space, parentIssue: value, shouldSaveDraft: true },
      'top'
    )
  }
</script>

{#if editable}
  <div class="buttons-group xsmall-gap">
    <StatusEditor {value} {size} kind={'regular'} iconSize={'small'} shouldShowLabel isEditable />
    <AssigneeEditor object={value} {size} {kind} avatarSize={'card'} shouldShowName={false} />
    {#if showNewSubIssue}
      <Button
        id={'btnNewSubIssue'}
        icon={tracker.icon.Subissue}
        iconProps={{ size: 'small' }}
        {kind}
        {size}
        showTooltip={{ label: tracker.string.NewSubIssue, direction: 'bottom' }}
        on:click={createSubIssue}
      />
    {/if}
  </div>
{/if}
