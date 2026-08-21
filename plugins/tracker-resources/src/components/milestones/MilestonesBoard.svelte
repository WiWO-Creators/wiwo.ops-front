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
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { makeRank } from '@hcengineering/task'
  import { Milestone, Project } from '@hcengineering/tracker'
  import { Loading } from '@hcengineering/ui'
  import view, { Viewlet, ViewletPreference, ViewOptions } from '@hcengineering/view'

  import tracker from '../../plugin'
  import { excludeCompletedQuery } from '../../utils'
  import KanbanView from '../issues/KanbanView.svelte'

  export let query: DocumentQuery<Milestone> = {}
  export let space: Ref<Project> | undefined = undefined
  export let viewOptions: ViewOptions

  const client = getClient()

  const milestonesQuery = createQuery()
  let milestones: Array<Ref<Milestone>> | undefined

  // Ordenados por `rank`, que es el orden manual: el equivalente de `milestone_order` del board
  // (Projects_model::get_milestones ordena por ese campo). La migracion lo respeta y arrastrar una
  // columna lo reescribe.
  $: milestonesQuery.query(
    tracker.class.Milestone,
    space !== undefined ? { ...query, space } : query,
    (res) => {
      milestones = res.map((it) => it._id)
    },
    { sort: { rank: SortingOrder.Ascending } }
  )

  // 3 — La columna de las tareas sin hito solo existe si hay alguna, igual que el `continue` de
  // milestones_kan_ban.php. Se consulta aparte porque las tareas las carga el tablero por dentro;
  // `limit: 1` alcanza para saber si hay o no. `milestone: null` tambien matchea las tareas que
  // nunca tuvieron el campo escrito: el motor lo traduce a `IS NULL`.
  const sinHitoQuery = createQuery()
  let haySinHito = false
  $: sinHitoQuery.query(
    tracker.class.Issue,
    excludeCompletedQuery(viewOptions.excludeCompleted === true, {
      ...(space !== undefined ? { space } : {}),
      milestone: null
    }),
    (res) => {
      haySinHito = res.length > 0
    },
    { limit: 1 }
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

  // Una columna por hito, haya o no tareas, con la de "Sin hito" a la izquierda cuando corresponde.
  // La categoria de esa columna es `undefined` y no `null`: groupBy normaliza el valor con
  // `?? undefined` (view-resources/src/utils.ts:1035), asi que las tareas sin hito caen en esa bolsa.
  $: forcedCategories =
    milestones === undefined
      ? undefined
      : ((haySinHito ? [undefined, ...milestones] : [...milestones]) as CategoryType[])

  // La columna de las tareas sin hito queda fija a la izquierda: en el board, `after_milestones_kanban`
  // cancela cualquier arrastre que deje una columna antes de la de "Sin categoria".
  $: fixedCategories = haySinHito ? [0] : []

  /**
   * Reescribe el orden manual del hito movido.
   *
   * Sólo se toca el hito arrastrado: `makeRank` genera un valor entre sus dos nuevos vecinos, así
   * que los demás no cambian. `from` y `to` son posiciones dentro de `forcedCategories`, que puede
   * llevar la columna sin hito adelante, por eso se trabaja sobre una copia ya sin ella.
   */
  async function reordenarHitos (from: number, to: number): Promise<void> {
    if (milestones === undefined || space === undefined) return
    const offset = haySinHito ? 1 : 0
    const desde = from - offset
    const hasta = to - offset
    if (desde < 0 || hasta < 0 || desde === hasta) return

    const orden = [...milestones]
    const [movido] = orden.splice(desde, 1)
    if (movido === undefined) return
    orden.splice(hasta, 0, movido)

    const docs = await client.findAll(tracker.class.Milestone, { _id: { $in: orden } })
    const porId = new Map(docs.map((it) => [it._id, it]))
    const anterior = hasta > 0 ? porId.get(orden[hasta - 1])?.rank : undefined
    const siguiente = hasta < orden.length - 1 ? porId.get(orden[hasta + 1])?.rank : undefined

    const doc = porId.get(movido)
    if (doc === undefined) return
    await client.updateDoc(tracker.class.Milestone, doc.space, doc._id, {
      rank: makeRank(anterior, siguiente)
    })
  }
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
    {fixedCategories}
    onCategoryReorder={(from, to) => {
      void reordenarHitos(from, to)
    }}
  />
{/if}
