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
  import core, { type ModulePermissionGroup, type Ref } from '@hcengineering/core'
  import { getFirstName } from '@hcengineering/contact'
  import { myEmployeeStore } from '@hcengineering/contact-resources'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Icon, Label, Scroller, getPlatformColorForTextDef, themeStore } from '@hcengineering/ui'
  import { NavLink } from '@hcengineering/view-resources'
  import workbenchPlugin, { type Application } from '@hcengineering/workbench'

  import workbench from '../plugin'
  import { filterVisibleApplications, getDisabledApplications } from '../utils'

  // Sólo copy de presentación: qué módulos existen lo decide el modelo, no este mapa.
  // Un módulo sin entrada acá se muestra igual, apenas sin bajada.
  const descriptions: Record<string, IntlString> = {
    tracker: workbench.string.HomeCardTracker,
    card: workbench.string.HomeCardCard,
    contact: workbench.string.HomeCardContact,
    document: workbench.string.HomeCardDocument,
    chunter: workbench.string.HomeCardChunter,
    time: workbench.string.HomeCardTime,
    love: workbench.string.HomeCardLove
  }

  const allApps = getClient().getModel().findAllSync<Application>(workbenchPlugin.class.Application, {})

  let hiddenAppsIds: Array<Ref<Application>> = []
  let disabledApplications: Set<Ref<Application>> = new Set<Ref<Application>>()

  const hiddenAppsIdsQuery = createQuery()
  hiddenAppsIdsQuery.query(workbenchPlugin.class.HiddenApplication, { space: core.space.Workspace }, (res) => {
    hiddenAppsIds = res.map((r) => r.attachedTo)
  })

  const modulePermissionGroupsQuery = createQuery()
  modulePermissionGroupsQuery.query(core.class.ModulePermissionGroup, {}, (res) => {
    try {
      disabledApplications = getDisabledApplications(res as ModulePermissionGroup[])
    } catch (error) {
      console.error('Error loading module permission groups:', error)
    }
  })

  // El empleado puede no estar cargado todavía, o no tener nombre: entonces se saluda sin nombre.
  $: firstName = $myEmployeeStore?.name !== undefined ? getFirstName($myEmployeeStore.name).trim() : ''

  // Los módulos de verdad: los de arriba (Inicio, Bandeja) y los de abajo ya viven en la barra.
  $: modules = filterVisibleApplications(allApps, hiddenAppsIds, disabledApplications)
    .filter((app) => app.position !== 'top' && app.position !== 'bottom')
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))

  function cardColor (alias: string, dark: boolean): { background: string, icon: string } {
    const def = getPlatformColorForTextDef(alias, dark)
    return { background: def.background ?? def.color, icon: def.icon ?? def.color }
  }
</script>

<Scroller padding={'var(--spacing-6) var(--spacing-4)'}>
  <div class="home">
    <h1 class="greeting">
      <Label label={workbench.string.HomeGreeting} />{#if firstName !== ''},
        <span class="accent">{firstName}</span>
      {/if}
    </h1>
    <p class="font-regular-14 subtitle"><Label label={workbench.string.HomeSubtitle} /></p>
    <div class="rule" />

    {#if modules.length === 0}
      <p class="font-regular-14 subtitle"><Label label={workbench.string.HomeEmpty} /></p>
    {:else}
      <div class="grid">
        {#each modules as app (app._id)}
          {@const color = cardColor(app.alias, $themeStore.dark)}
          <NavLink app={app.alias} restoreLastLocation>
            <article class="card" data-id={`home-card-${app.alias}`}>
              <div class="badge" style:background-color={color.background}>
                <Icon icon={app.icon} size={'medium'} fill={color.icon} />
              </div>
              <h2 class="heading-medium-16"><Label label={app.label} /></h2>
              {#if descriptions[app.alias] !== undefined}
                <p class="font-regular-14 subtitle"><Label label={descriptions[app.alias]} /></p>
              {/if}
            </article>
          </NavLink>
        {/each}
      </div>
    {/if}
  </div>
</Scroller>

<style lang="scss">
  .home {
    margin: 0 auto;
    max-width: 64rem;
    width: 100%;
  }
  .greeting {
    margin: 0;
    font-family: var(--font-brand);
    font-size: 3rem;
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--global-primary-TextColor);

    .accent {
      color: var(--global-accent-TextColor);
    }
  }
  .subtitle {
    margin: 0;
    color: var(--global-tertiary-TextColor);
  }
  .greeting + .subtitle {
    margin-top: var(--spacing-1_5);
  }
  .rule {
    margin: var(--spacing-3) 0 var(--spacing-6);
    width: 7.5rem;
    height: 0.25rem;
    border-radius: var(--min-BorderRadius);
    background-color: var(--global-accent-BackgroundColor);
  }
  .grid {
    display: grid;
    // auto-fill nativo: responsive sin media queries ni JS
    grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
    gap: var(--spacing-3);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-1);
    padding: var(--spacing-3);
    height: 100%;
    border: 1px solid var(--global-surface-01-BorderColor);
    border-radius: var(--medium-BorderRadius);
    background-color: var(--global-surface-01-BackgroundColor);
    transition: background-color 0.15s ease;

    &:hover {
      background-color: var(--global-surface-01-hover-BackgroundColor);
    }

    h2 {
      margin: 0 0 var(--spacing-0_25);
      color: var(--global-primary-TextColor);
    }
  }
  .badge {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: var(--spacing-2);
    width: 2.75rem;
    height: 2.75rem;
    border-radius: var(--small-BorderRadius);
  }
  :global(a:focus-visible) .card {
    outline: 2px solid var(--global-focus-BorderColor);
    outline-offset: 2px;
  }
</style>
