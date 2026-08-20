<!--
// Copyright © 2026 WiWO
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
<!--
  Segunda línea de la cabecera de una columna del tablero de hitos: el rango de fechas del hito y
  el tiempo registrado en sus tareas.

  El tiempo aparece sólo cuando hay algo registrado. Hoy nunca lo hay, porque los timers de Perfex
  no se migraron: mostrar "Tiempo registrado: 0h" en cada columna sería ruido. Cuando se carguen
  las horas, aparece solo.
-->
<script lang="ts">
  import { Doc, Ref } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Issue, Milestone } from '@hcengineering/tracker'
  import { Label, themeStore } from '@hcengineering/ui'

  import tracker from '../../plugin'
  import TimePresenter from '../issues/timereport/TimePresenter.svelte'

  /** Hito de la columna. Sin valor, es la columna de las tareas sin hito. */
  export let milestone: Ref<Milestone> | undefined = undefined
  /** Tareas que hoy se ven en la columna. */
  export let issues: Doc[] = []

  const milestoneQuery = createQuery()
  let doc: Milestone | undefined
  $: if (milestone !== undefined) {
    milestoneQuery.query(tracker.class.Milestone, { _id: milestone }, (res) => {
      doc = res[0]
    })
  } else {
    doc = undefined
  }

  /**
   * Suma el tiempo registrado de la columna sin contar dos veces las subtareas que también están
   * en ella: si una tarea tiene hijas, su total ya las incluye.
   */
  function totalReported (docs: Doc[]): number {
    const list = docs as Issue[]
    const ids = new Set(list.map((it) => it._id))
    return list
      .filter((it) => !ids.has(it.attachedTo))
      .reduce((total, it) => {
        const children = (it.childInfo ?? []).reduce((sum, child) => sum + child.reportedTime, 0)
        return total + it.reportedTime + children
      }, 0)
  }

  function formatRange (from: number | null | undefined, to: number | null | undefined, language: string): string {
    const format = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric' })
    const parts = [from, to].filter((it): it is number => it != null).map((it) => format.format(new Date(it)))
    return parts.join(' - ')
  }

  $: range = doc !== undefined ? formatRange(doc.startDate, doc.targetDate, $themeStore.language) : ''
  $: reported = totalReported(issues)
</script>

{#if range !== '' || reported > 0}
  <div class="milestone-subtitle overflow-label">
    {#if range !== ''}
      <span>{range}</span>
    {/if}
    {#if reported > 0}
      {#if range !== ''}
        <span class="separator">·</span>
      {/if}
      <Label label={tracker.string.MilestoneLoggedTime} />:
      <TimePresenter value={reported} />
    {/if}
  </div>
{/if}

<style lang="scss">
  .milestone-subtitle {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .separator {
    opacity: 0.6;
  }
</style>
