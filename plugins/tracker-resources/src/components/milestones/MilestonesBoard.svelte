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
  Tablero de hitos: cada columna es un hito del proyecto y cada tarjeta, una tarea suya.

  Recibe de MilestoneContent los hitos ya filtrados por el selector Todos/Planificados/Activos/
  Cerrados y por la búsqueda, y arma con ellos la consulta de tareas que come el tablero de
  Procesos, agrupada por hito. La columna sin hito ("Sin categoría") sale de incluir `null`.
-->
<script lang="ts">
  import core, { CategoryType, DocumentQuery, Ref, SortingOrder, WithLookup } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { Milestone, Project } from '@hcengineering/tracker'
  import { Loading } from '@hcengineering/ui'
  import view, { Viewlet, ViewletPreference, ViewOptions } from '@hcengineering/view'

  import tracker from '../../plugin'
  import KanbanView from '../issues/KanbanView.svelte'

  export let query: DocumentQuery<Milestone> = {}
  export let space: Ref<Project> | undefined = undefined
  export let viewOptions: ViewOptions

  const milestonesQuery = createQuery()
  let milestones: Array<Ref<Milestone>> | undefined

  // Ordenados por fecha de vencimiento: las columnas van de la mas temprana a la mas tardia, que
  // es como se lee un tablero de hitos. `rank` existe para reordenarlos a mano, pero un hito
  // creado desde la interfaz todavia no lo trae y quedaria en un lugar impredecible.
  $: milestonesQuery.query(
    tracker.class.Milestone,
    space !== undefined ? { ...query, space } : query,
    (res) => {
      milestones = res.map((it) => it._id)
    },
    { sort: { targetDate: SortingOrder.Ascending } }
  )

  const viewletQuery = createQuery()
  let issueViewlet: WithLookup<Viewlet> | undefined
  viewletQuery.query(
    view.class.Viewlet,
    { _id: tracker.viewlet.MilestoneBoardIssues },
    (res) => {
      issueViewlet = res[0]
    },
    { lookup: { descriptor: view.class.ViewletDescriptor } }
  )

  // Las columnas visibles y su ancho son preferencia de cada usuario, igual que en el resto de
  // las vistas.
  const preferenceQuery = createQuery()
  let preference: ViewletPreference | undefined
  $: if (issueViewlet !== undefined) {
    preferenceQuery.query(
      view.class.ViewletPreference,
      { space: core.space.Workspace, attachedTo: issueViewlet._id },
      (res) => {
        preference = res[0]
      },
      { limit: 1 }
    )
  }

  // `null` es la columna de las tareas sin hito.
  $: issueQuery =
    milestones === undefined
      ? undefined
      : {
          ...(space !== undefined ? { space } : {}),
          milestone: { $in: [...milestones, null] }
        }

  /**
   * Opciones con las que corre el tablero de tareas.
   *
   * No son las de la barra de Hitos —esas son de la clase Milestone— sino las que trae de fábrica
   * el viewlet de tareas, con el agrupado por hito forzado, que es lo que define esta vista. Lo
   * único que viaja desde la barra es "Excluir tareas completadas".
   */
  function buildBoardOptions (viewlet: Viewlet, barra: ViewOptions): ViewOptions {
    const defaults: Record<string, any> = {}
    for (const option of viewlet.viewOptions?.other ?? []) {
      defaults[option.key] = option.defaultValue
    }
    return {
      ...defaults,
      excludeCompleted: barra.excludeCompleted === true,
      groupBy: ['milestone'],
      orderBy: viewlet.viewOptions?.orderBy[0] ?? ['modifiedOn', SortingOrder.Descending]
    }
  }

  $: boardViewOptions = issueViewlet !== undefined ? buildBoardOptions(issueViewlet, viewOptions) : undefined

  // Una columna por hito, haya o no tareas, con la de "Sin hito" a la izquierda. La categoria de
  // esa columna es `undefined` y no `null`: groupBy normaliza el valor con `?? undefined`
  // (view-resources/src/utils.ts:1035), asi que las tareas sin hito caen en esa bolsa.
  $: forcedCategories =
    milestones === undefined ? undefined : ([undefined, ...milestones] as CategoryType[])
</script>

{#if issueViewlet === undefined || issueQuery === undefined || boardViewOptions === undefined}
  <Loading />
{:else}
  <KanbanView
    query={issueQuery}
    {space}
    viewlet={issueViewlet}
    config={preference?.config ?? issueViewlet.config}
    viewOptions={boardViewOptions}
    viewOptionsConfig={issueViewlet.viewOptions?.other}
    {forcedCategories}
  />
{/if}
