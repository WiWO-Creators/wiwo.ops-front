<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { AttachmentsPresenter } from '@hcengineering/attachment-resources'
  import {
    CategoryType,
    Class,
    Doc,
    DocumentQuery,
    DocumentUpdate,
    FindOptions,
    generateId,
    Lookup,
    mergeQueries,
    Ref,
    WithLookup
  } from '@hcengineering/core'
  import { Item, Kanban as KanbanUI } from '@hcengineering/kanban'
  import notification from '@hcengineering/notification'
  import { ActionContext, createQuery, getClient } from '@hcengineering/presentation'
  import tags from '@hcengineering/tags'
  import task, { DocWithRank, getStates } from '@hcengineering/task'
  import { getTaskKanbanResultQuery, typeStore, updateTaskKanbanCategories } from '@hcengineering/task-resources'
  import { Issue, IssuesGrouping, IssuesOrdering, Milestone, Project } from '@hcengineering/tracker'
  import {
    Button,
    ColorDefinition,
    Component,
    defaultBackground,
    eventToHTMLElement,
    getEventPositionElement,
    getPlatformColorDef,
    Icon,
    IconAdd,
    Label,
    Loading,
    showPopup,
    themeStore
  } from '@hcengineering/ui'
  import view, { AttributeModel, BuildModelKey, Viewlet, ViewOptionModel, ViewOptions } from '@hcengineering/view'
  import {
    enabledConfig,
    focusStore,
    ColorsPopup,
    getCategoryQueryNoLookup,
    getCategoryQueryNoLookupOptions,
    getCategoryQueryProjection,
    getGroupByValues,
    getPresenter,
    groupBy,
    ListSelectionProvider,
    Menu,
    noCategory,
    openDoc,
    SelectDirection,
    setGroupByValues,
    showMenu,
    statusStore
  } from '@hcengineering/view-resources'
  import { ChatMessagesPresenter } from '@hcengineering/chunter-resources'
  import { getCurrentEmployee } from '@hcengineering/contact'
  import { onMount } from 'svelte'

  import tracker from '../../plugin'
  import { activeProjects } from '../../utils'
  import ComponentEditor from '../components/ComponentEditor.svelte'
  import CreateIssue from '../CreateIssue.svelte'
  import AssigneeEditor from './AssigneeEditor.svelte'
  import DueDatePresenter from './DueDatePresenter.svelte'
  import SubIssuesSelector from './edit/SubIssuesSelector.svelte'
  import IssuePresenter from './IssuePresenter.svelte'
  import ParentNamesPresenter from './ParentNamesPresenter.svelte'
  import PriorityEditor from './PriorityEditor.svelte'
  import StatusEditor from './StatusEditor.svelte'
  import EstimationEditor from './timereport/EstimationEditor.svelte'
  import MilestoneEditor from '../milestones/MilestoneEditor.svelte'
  import MilestoneColumnSubtitle from '../milestones/MilestoneColumnSubtitle.svelte'
  import TimePresenter from './timereport/TimePresenter.svelte'

  const _class = tracker.class.Issue
  export let space: Ref<Project> | undefined = undefined
  export let baseMenuClass: Ref<Class<Doc>> | undefined = undefined
  export let query: DocumentQuery<Issue> = {}
  export let viewOptionsConfig: ViewOptionModel[] | undefined = undefined
  export let viewOptions: ViewOptions
  export let viewlet: Viewlet
  export let config: (string | BuildModelKey)[]
  export let options: FindOptions<DocWithRank> | undefined = undefined

  $: groupByKey = (viewOptions.groupBy[0] ?? noCategory) as IssuesGrouping
  $: orderBy = viewOptions.orderBy

  // Los extras del tablero de hitos —fechas y tiempo en la cabecera y en la tarjeta, y el color
  // de la tarjeta— sólo se pintan cuando las columnas son hitos, para no cambiar el tablero de
  // Procesos.
  $: isMilestoneBoard = groupByKey === IssuesGrouping.Milestone

  const myEmployeeId = getCurrentEmployee()

  /** Una tarea está terminada cuando su estado es de categoría ganada o perdida. */
  function isCompleted (issue: WithLookup<Issue>): boolean {
    const category = $statusStore.byId.get(issue.status)?.category
    return category === task.statusCategory.Won || category === task.statusCategory.Lost
  }

  /** Una tarea está atrasada si venció y todavía no terminó. */
  function isOverdue (issue: WithLookup<Issue>): boolean {
    if (issue.dueDate == null || issue.dueDate >= Date.now()) return false
    return !isCompleted(issue)
  }

  /** Abre la paleta de Huly y guarda el color elegido en el hito de la columna. */
  async function elegirColorDeHito (milestone: Ref<Milestone> | undefined, ev: MouseEvent): Promise<void> {
    if (milestone === undefined) return
    const doc = await client.findOne(tracker.class.Milestone, { _id: milestone })
    if (doc === undefined) return
    showPopup(
      ColorsPopup,
      { selected: doc.color !== undefined ? getPlatformColorDef(doc.color, $themeStore.dark).name : undefined },
      eventToHTMLElement(ev),
      (color) => {
        if (color == null) return
        void client.updateDoc(tracker.class.Milestone, doc.space, doc._id, { color })
      }
    )
  }

  /** La categoría de una columna de hitos es su id, salvo en la columna de las tareas sin hito. */
  function toMilestoneRef (state: CategoryType): Ref<Milestone> | undefined {
    return typeof state === 'string' ? (state as Ref<Milestone>) : undefined
  }

  /** "10/08/2026 - 12/08/2026", o una sola fecha si falta la otra. */
  function formatIssueRange (issue: WithLookup<Issue>, language: string): string {
    const format = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric' })
    return [issue.startDate, issue.dueDate]
      .filter((it): it is number => it != null)
      .map((it) => format.format(new Date(it)))
      .join(' - ')
  }

  let accentColors = new Map<string, ColorDefinition>()
  const setAccentColor = (n: number, ev: CustomEvent<ColorDefinition>) => {
    accentColors.set(`${n}${$themeStore.dark}${groupByKey}`, ev.detail)
    accentColors = accentColors
  }

  $: dontUpdateRank = orderBy[0] !== IssuesOrdering.Manual

  $: currentSpace = space ?? tracker.project.DefaultProject
  let currentProject: Project | undefined
  $: currentProject = $activeProjects.get(currentSpace) as Project

  let resultQuery: DocumentQuery<any> = { ...query }
  const client = getClient()

  $: void getTaskKanbanResultQuery(client.getHierarchy(), query, viewOptionsConfig, viewOptions).then((p) => {
    resultQuery = mergeQueries(p, query)
  })

  $: queryNoLookup = getCategoryQueryNoLookup(resultQuery)

  function toIssue (object: any): WithLookup<Issue> {
    return object as WithLookup<Issue>
  }

  const lookup: Lookup<Issue> = {
    ...(options?.lookup ?? {}),
    attachedTo: tracker.class.Issue,
    _id: {
      subIssues: tracker.class.Issue
    }
  }

  $: resultOptions = { ...options, lookup, ...(orderBy !== undefined ? { sort: { [orderBy[0]]: orderBy[1] } } : {}) }

  let kanbanUI: KanbanUI
  const listProvider = new ListSelectionProvider((offset: 1 | -1 | 0, of?: Doc, dir?: SelectDirection) => {
    kanbanUI?.select(offset, of, dir)
  })
  const selection = listProvider.selection

  onMount(() => {
    ;(document.activeElement as HTMLElement)?.blur()
  })

  // Category information only
  let tasks: DocWithRank[] = []

  $: groupByDocs = groupBy(tasks, groupByKey, categories)

  let fastDocs: DocWithRank[] = []
  let slowDocs: DocWithRank[] = []

  const docsQuery = createQuery()
  const docsQuerySlow = createQuery()

  let fastQueryIds = new Set<Ref<DocWithRank>>()

  let categoryQueryOptions: Partial<FindOptions<DocWithRank>>
  $: categoryQueryOptions = {
    ...getCategoryQueryNoLookupOptions(resultOptions),
    projection: {
      ...resultOptions.projection,
      _id: 1,
      _class: 1,
      rank: 1,
      ...getCategoryQueryProjection(client.getHierarchy(), _class, queryNoLookup, viewOptions.groupBy)
    }
  }

  $: docsQuery.query(
    _class,
    queryNoLookup,
    (res) => {
      fastDocs = res
      fastQueryIds = new Set(res.map((it) => it._id))
    },
    { ...categoryQueryOptions, limit: 1000 }
  )
  $: docsQuerySlow.query(
    _class,
    queryNoLookup,
    (res) => {
      slowDocs = res
    },
    categoryQueryOptions
  )

  $: tasks = [...fastDocs, ...slowDocs.filter((it) => !fastQueryIds.has(it._id))]

  $: listProvider.update(tasks)

  // Cuando quien monta el tablero ya sabe cuales son las columnas —el tablero de hitos, que las
  // saca de la lista de hitos y no de las tareas— las impone. Sin esto un hito sin tareas no
  // genera columna, y un espacio sin ninguna tarea deja el tablero en blanco.
  export let forcedCategories: CategoryType[] | undefined = undefined

  /** Reordenar columnas arrastrando. Lo pasa el tablero de hitos; el de Procesos no. */
  export let onCategoryReorder: ((from: number, to: number) => void) | undefined = undefined

  /** Columnas fijas, que no se mueven ni dejan que otra quede antes. */
  export let fixedCategories: number[] = []

  let categories: CategoryType[] = []
  let loadCategories = true

  const queryId = generateId()

  function update (): void {
    if (forcedCategories !== undefined) {
      categories = forcedCategories
      loadCategories = false
      return
    }
    void updateTaskKanbanCategories(
      client,
      viewlet,
      _class,
      space,
      tasks,
      groupByKey,
      viewOptions,
      viewOptionsConfig,
      update,
      queryId
    ).then((res) => {
      categories = res
      loadCategories = false
    })
  }

  $: if (forcedCategories !== undefined) {
    categories = forcedCategories
    loadCategories = false
  } else {
    void updateTaskKanbanCategories(
      client,
      viewlet,
      _class,
      space,
      tasks,
      groupByKey,
      viewOptions,
      viewOptionsConfig,
      update,
      queryId
    ).then((res) => {
      categories = res
      loadCategories = false
    })
  }

  const fullFilled: Record<string, boolean> = {}

  function getHeader (_class: Ref<Class<Doc>>, groupByKey: string): void {
    if (groupByKey === noCategory) {
      headerComponent = undefined
    } else {
      void getPresenter(client, _class, { key: groupByKey }, { key: groupByKey }).then((p) => {
        headerComponent = p
      })
    }
  }

  let headerComponent: AttributeModel | undefined
  $: getHeader(_class, groupByKey)

  const getUpdateProps = (doc: Doc, category: CategoryType): DocumentUpdate<Item> | undefined => {
    const groupValue =
      typeof category === 'object' ? category.values.find((it) => it.space === doc.space)?._id : category
    if (groupValue === undefined) {
      return undefined
    }
    return {
      [groupByKey]: groupValue,
      space: doc.space
    }
  }

  async function shouldShowFooter (
    config: (string | BuildModelKey)[],
    reports: number,
    estimations: number,
    issue: WithLookup<Issue>
  ): Promise<boolean> {
    if (enabledConfig(config, 'estimation') && (reports > 0 || estimations > 0)) return true
    if (enabledConfig(config, 'comments')) {
      if ((issue.comments ?? 0) > 0) return true
      if ((issue.$lookup?.attachedTo?.comments ?? 0) > 0) return true
    }
    if (enabledConfig(config, 'attachments') && (issue.attachments ?? 0) > 0) return true
    return false
  }

  const getAvailableCategories = async (doc: Doc): Promise<CategoryType[]> => {
    const issue = toIssue(doc)

    if ([IssuesGrouping.Component, IssuesGrouping.Milestone].includes(groupByKey)) {
      const availableCategories = []
      const clazz = client.getHierarchy().getAttribute(tracker.class.Issue, groupByKey)

      for (const category of categories) {
        if (!category || (issue as any)[groupByKey] === category) {
          availableCategories.push(category)
        } else if (clazz !== undefined && 'to' in clazz.type) {
          const categoryDoc = await client.findOne(clazz.type.to as Ref<Class<Doc>>, {
            _id: category as Ref<Doc>,
            space: issue.space
          })

          if (categoryDoc) {
            availableCategories.push(category)
          }
        }
      }

      return availableCategories
    }

    if (groupByKey === IssuesGrouping.Status) {
      const space = await client.findOne(tracker.class.Project, { _id: issue.space })
      return getStates(space, $typeStore, $statusStore.byId).map(({ _id }) => _id)
    }

    return categories
  }
</script>

{#if loadCategories}
  <Loading />
{:else}
  <ActionContext
    context={{
      mode: 'browser'
    }}
  />
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <KanbanUI
    bind:this={kanbanUI}
    {categories}
    {onCategoryReorder}
    {fixedCategories}
    {dontUpdateRank}
    {_class}
    query={resultQuery}
    options={resultOptions}
    objects={tasks}
    getGroupByValues={(groupByDocs, category) =>
      groupByKey === noCategory ? tasks : getGroupByValues(groupByDocs, category)}
    {setGroupByValues}
    {getUpdateProps}
    {groupByDocs}
    {groupByKey}
    on:obj-focus={(evt) => {
      listProvider.updateFocus(evt.detail)
    }}
    {getAvailableCategories}
    selection={listProvider.current($focusStore)}
    checked={$selection ?? []}
    on:check={(evt) => {
      listProvider.updateSelection(evt.detail.docs, evt.detail.value)
    }}
    on:contextmenu={(evt) => {
      showMenu(evt.detail.evt, { object: evt.detail.objects, baseMenuClass })
    }}
  >
    <svelte:fragment slot="header" let:state let:count let:index>
      {@const color = accentColors.get(`${index}${$themeStore.dark}${groupByKey}`)}
      {@const headerBGColor = color?.background ?? defaultBackground($themeStore.dark)}
      <div
        style:background={headerBGColor}
        class="header"
        class:flex-between={!isMilestoneBoard}
        class:milestone-header={isMilestoneBoard}
      >
        <div class="flex-between w-full">
          <div class="flex-row-center gap-1">
            <span
              class="clear-mins fs-bold overflow-label pointer-events-none"
              style:color={color?.title ?? 'var(--theme-caption-color)'}
            >
              {#if groupByKey === noCategory}
                <Label label={view.string.NoGrouping} />
              {:else if isMilestoneBoard && state == null}
                <!-- La columna de las tareas sin hito. El presenter del hito mostraría "Hitos",
                     que no dice nada. -->
                <Label label={tracker.string.NoMilestone} />
              {:else if headerComponent}
                <svelte:component
                  this={headerComponent.presenter}
                  value={state}
                  {space}
                  size={'small'}
                  kind={'list-header'}
                  display={'kanban'}
                  colorInherit={!$themeStore.dark}
                  accent
                  on:accent-color={(ev) => {
                    setAccentColor(index, ev)
                  }}
                />
              {/if}
            </span>
            <span class="counter ml-1">
              {count}
            </span>
          </div>
          <div class="tools gap-1">
            {#if isMilestoneBoard && state != null}
              <!-- Elegir el color del hito desde su columna, como el popover del board. El
                   presenter ya pinta la cabecera con ese color, asi que el cambio se ve solo. -->
              <Button
                icon={view.icon.Circle}
                kind={'ghost'}
                showTooltip={{ label: view.string.Color, direction: 'left' }}
                on:click={(ev) => {
                  void elegirColorDeHito(toMilestoneRef(state), ev)
                }}
              />
            {/if}
            <Button
              icon={IconAdd}
              kind={'ghost'}
              showTooltip={{ label: tracker.string.AddIssueTooltip, direction: 'left' }}
              on:click={() => {
                showPopup(CreateIssue, { space: currentSpace, [groupByKey]: state }, 'top')
              }}
            />
          </div>
        </div>
        {#if isMilestoneBoard}
          <MilestoneColumnSubtitle milestone={toMilestoneRef(state)} issues={getGroupByValues(groupByDocs, state)} />
        {/if}
      </div>
    </svelte:fragment>
    <!-- Una columna sin tareas lo dice, en vez de quedar en blanco. En el board es el bloque
         `kanban-empty` de milestones_kan_ban.php. -->
    <svelte:fragment slot="afterCard" let:state>
      {#if isMilestoneBoard && getGroupByValues(groupByDocs, state).length === 0}
        <div class="empty-column">
          <Icon icon={tracker.icon.Milestone} size={'medium'} />
          <span><Label label={tracker.string.MilestoneNoTasks} /></span>
        </div>
      {/if}
    </svelte:fragment>
    <svelte:fragment slot="card" let:object>
      {@const issue = toIssue(object)}
      {@const issueId = object._id}
      {@const reports =
        issue.reportedTime + (issue.childInfo ?? []).map((it) => it.reportedTime).reduce((a, b) => a + b, 0)}
      {@const estimations = (issue.childInfo ?? []).map((it) => it.estimation).reduce((a, b) => a + b, 0)}
      {#key issueId}
        <div
          class="tracker-card"
          class:mine={isMilestoneBoard && issue.assignee != null && issue.assignee === myEmployeeId}
          class:overdue={isMilestoneBoard && isOverdue(issue)}
          on:click={() => {
            void openDoc(client.getHierarchy(), issue)
          }}
        >
          <div class="card-header flex-between">
            <div class="flex-row-center text-sm">
              <!-- {#if groupByKey !== 'status'} -->
              <div class="mr-1">
                <StatusEditor value={issue} kind="list" isEditable={false} />
              </div>
              <!-- {/if} -->
              <div class="flex-no-shrink">
                <IssuePresenter value={issue} />
              </div>
              <ParentNamesPresenter value={issue} />
            </div>
            <div class="flex-row-center gap-2 reverse flex-no-shrink">
              <Component is={notification.component.NotificationPresenter} props={{ value: object }} />
              <AssigneeEditor object={issue} avatarSize={'card'} shouldShowName={false} />
            </div>
          </div>
          <div
            class="card-content text-md caption-color lines-limit-2"
            class:done={isMilestoneBoard && isCompleted(issue)}
          >
            {object.title}
          </div>
          <div class="card-labels">
            {#if enabledConfig(config, 'subIssues') && issue && issue.subIssues > 0}
              <SubIssuesSelector value={issue} {currentProject} size={'small'} />
            {/if}
            {#if enabledConfig(config, 'priority')}
              <PriorityEditor
                value={issue}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'component')}
              <ComponentEditor
                value={issue}
                {space}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'milestone')}
              <MilestoneEditor
                value={issue}
                {space}
                isEditable={true}
                kind={'link-bordered'}
                size={'small'}
                justify={'center'}
              />
            {/if}
            {#if enabledConfig(config, 'dueDate') && !isMilestoneBoard}
              <DueDatePresenter value={issue} size={'small'} kind={'link-bordered'} />
            {/if}
          </div>
          {#if isMilestoneBoard && (issue.startDate != null || issue.dueDate != null || reports > 0)}
            <div class="card-dates">
              {#if issue.startDate != null || issue.dueDate != null}
                <span>{formatIssueRange(issue, $themeStore.language)}</span>
              {/if}
              <!-- El tiempo registrado sólo se muestra si hay algo: los timers de Perfex no se
                   migraron, así que hoy todas las tareas están en cero. -->
              {#if reports > 0}
                {#if issue.startDate != null || issue.dueDate != null}
                  <span class="separator">·</span>
                {/if}
                <Label label={tracker.string.MilestoneLoggedTime} />:
                <TimePresenter value={reports} />
              {/if}
            </div>
          {/if}
          {#if enabledConfig(config, 'labels')}
            <div class="card-labels labels">
              <Component
                is={tags.component.LabelsPresenter}
                props={{
                  value: issue.labels,
                  object: issue,
                  ckeckFilled: fullFilled[issueId],
                  kind: 'link',
                  compression: true
                }}
                on:change={(res) => {
                  if (res.detail.full) fullFilled[issueId] = true
                }}
              />
            </div>
          {/if}
          {#await shouldShowFooter(config, reports, estimations, object) then withFooter}
            {#if withFooter}
              <div class="card-footer flex-between">
                {#if enabledConfig(config, 'estimation')}
                  <EstimationEditor kind={'list'} size={'small'} value={issue} />
                {/if}
                <div class="flex-row-center gap-3 reverse">
                  {#if enabledConfig(config, 'attachments') && (object.attachments ?? 0) > 0}
                    <AttachmentsPresenter value={object.attachments} {object} />
                  {/if}
                  <ChatMessagesPresenter value={object.comments} {object} />
                  <ChatMessagesPresenter
                    object={object.$lookup?.attachedTo}
                    value={object.$lookup?.attachedTo?.comments}
                    withInput={false}
                  />
                </div>
              </div>
            {:else}
              <div class="min-h-4 max-h-4 h-4" />
            {/if}
          {/await}
        </div>
      {/key}
    </svelte:fragment>
  </KanbanUI>
{/if}

<style lang="scss">
  .header {
    margin: 0 0.75rem 0.5rem;
    padding: 0 0.5rem 0 1.25rem;
    height: 2.5rem;
    min-height: 2.5rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.25rem;

    .counter {
      color: var(--theme-dark-color);
    }
    .tools {
      opacity: 0;
    }
    &:hover .tools {
      opacity: 1;
    }

    // La cabecera del tablero de hitos lleva dos lineas: nombre y, debajo, fechas y tiempo.
    &.milestone-header {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding-top: 0.375rem;
      padding-bottom: 0.375rem;
      height: auto;
      min-height: 3.5rem;
    }
  }
  .empty-column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem 0;
    color: var(--theme-darker-color);
    font-size: 0.8125rem;
  }
  .tracker-card {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 6.5rem;
    border-radius: 0.25rem;

    // Igual que en el board: la tarea propia se destaca y la atrasada avisa. El color viene del
    // tema, asi que funciona en claro y en oscuro.
    &.mine {
      background-color: color-mix(in srgb, var(--primary-button-default) 12%, var(--theme-panel-color));
    }
    &.overdue {
      background-color: color-mix(in srgb, var(--theme-urgent-color) 14%, var(--theme-panel-color));
    }

    .card-dates {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      margin: 0.25rem 1rem 0;
      font-size: 0.75rem;
      color: var(--theme-dark-color);

      .separator {
        opacity: 0.6;
      }
    }

    // Igual que en el board: la tarea terminada se tacha y se atenua.
    .card-content.done {
      color: var(--theme-dark-color);
      text-decoration: line-through;
    }

    .card-header {
      padding: 0.75rem 1rem 0;
    }
    .card-content {
      margin: 0.5rem 1rem;
    }
    /* Global styles in components.scss */
    .card-labels {
      display: flex;
      flex-wrap: nowrap;
      margin: 0 0.75rem 0 1rem;
      min-width: 0;

      &.labels {
        overflow: hidden;
        flex-shrink: 1;
        margin: 0 1rem;
        width: calc(100% - 2rem);
        border-radius: 0 0.24rem 0.24rem 0;
      }
    }
    .card-footer {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background-color: var(--theme-kanban-card-footer);
      border-radius: 0 0 0.25rem 0.25rem;
    }
  }
</style>
