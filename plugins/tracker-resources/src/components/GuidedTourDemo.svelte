<script lang="ts">
  import type { Ref, WithLookup } from '@hcengineering/core'
  import { SelectPopup } from '@hcengineering/ui'
  import type { Viewlet, ViewletDescriptor } from '@hcengineering/view'
  import { ViewletSelector } from '@hcengineering/view-resources'
  import tracker from '../plugin'
  import CreateIssue from './CreateIssue.svelte'
  import NewIssueHeader from './NewIssueHeader.svelte'

  export let demo: string

  const demoViewlets = [
    {
      _id: 'guided-tour-list' as Ref<Viewlet>,
      title: 'Lista',
      descriptor: 'guided-tour-list-descriptor' as Ref<ViewletDescriptor>,
      config: [],
      $lookup: { descriptor: { label: tracker.string.Issues } }
    },
    {
      _id: 'guided-tour-board' as Ref<Viewlet>,
      title: 'Tablero',
      descriptor: 'guided-tour-board-descriptor' as Ref<ViewletDescriptor>,
      config: [],
      $lookup: { descriptor: { label: tracker.string.Board } }
    }
  ] as unknown as Array<WithLookup<Viewlet>>
  let viewlet = demoViewlets[0]
</script>

<div class="guided-tour-module-demo">
  {#if demo === 'tracker-header' || demo === 'tracker-menu'}
    <div class="tracker-header-demo">
      <NewIssueHeader currentSpace={undefined} tutorialDemo />
      {#if demo === 'tracker-menu'}
        <div class="tracker-menu-demo">
          <SelectPopup
            embedded
            value={[
              { id: 'project', label: tracker.string.CreateProject },
              { id: 'issue', label: tracker.string.NewIssue },
              { id: 'import', label: tracker.string.Import }
            ]}
          />
        </div>
      {/if}
    </div>
  {:else if demo === 'tracker-board'}
    <div data-tutorial="viewlet-selector" class="tracker-viewlet-demo">
      <ViewletSelector bind:viewlet viewlets={demoViewlets} viewletQuery={{}} tutorialDemo ignoreFragment />
    </div>
  {:else}
    <CreateIssue shouldSaveDraft={false} initialTitle="Ejemplo: revisar propuesta" />
  {/if}
</div>

<style lang="scss">
  .guided-tour-module-demo {
    min-width: min(52rem, calc(100vw - 4rem));
    min-height: 8rem;
    padding: 1rem;
  }
  .tracker-header-demo {
    width: 18rem;
  }
  .tracker-menu-demo {
    margin-top: 0.5rem;
  }
  .tracker-viewlet-demo {
    display: flex;
    align-items: center;
    min-height: 4rem;
    padding: 1rem;
    background: var(--theme-bg-color);
    border-radius: 0.5rem;
  }
</style>
