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
  import { Icon, Label, Scroller, themeStore } from '@hcengineering/ui'
  import { NavLink } from '@hcengineering/view-resources'
  import workbenchPlugin, { type Application } from '@hcengineering/workbench'

  import workbench from '../plugin'
  import { isOpsApplication } from '../opsTour'
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
    love: workbench.string.HomeCardLove,
    calendar: workbench.string.HomeCardCalendar,
    recruit: workbench.string.HomeCardRecruit,
    lead: workbench.string.HomeCardLead,
    hr: workbench.string.HomeCardHr,
    process: workbench.string.HomeCardProcess,
    drive: workbench.string.HomeCardDrive,
    team: workbench.string.HomeCardTeam,
    github: workbench.string.HomeCardGithub,
    questions: workbench.string.HomeCardQuestions,
    testManagement: workbench.string.HomeCardTestManagement
  }

  // Ni la propia vista Inicio ni la bandeja de entrada son módulos: son navegación.
  // Todo lo demás va al grid, incluidos los que además están fijos arriba en la barra
  // (Seguimiento, Planificador, Teletrabajo).
  // Matices vibrantes al estilo WiwoLab. Cada módulo elige el suyo por hash del alias:
  // uno nuevo se pinta solo, sin mapa manual que mantener.
  const accentHues = [226, 262, 292, 330, 8, 28, 45, 142, 168, 196]

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

  $: modules = filterVisibleApplications(allApps, hiddenAppsIds, disabledApplications)
    .filter((app) => isOpsApplication(app) && app.position !== 'bottom')
    .sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity))

  /**
   * Hash estable de un texto, para elegir siempre el mismo matiz por módulo.
   *
   * @param text - alias del módulo
   * @returns entero no negativo
   */
  function hashCode (text: string): number {
    const hash = text.split('').reduce((prev, char) => ((prev << 5) - prev + char.charCodeAt(0)) | 0, 0)
    return Math.abs(hash)
  }

  /**
   * Color de acento de una tarjeta: pinta el ícono, tiñe su recuadro y marca el
   * borde en hover.
   *
   * @param alias - alias del módulo
   * @param dark - si el tema oscuro está activo
   * @returns color CSS
   */
  function cardAccent (alias: string, dark: boolean): string {
    const hue = accentHues[hashCode(alias) % accentHues.length]
    return dark ? `hsl(${hue}, 82%, 66%)` : `hsl(${hue}, 88%, 52%)`
  }
</script>

<div class="home-aura">
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
            {@const accent = cardAccent(app.alias, $themeStore.dark)}
            <NavLink app={app.alias} restoreLastLocation>
              <article class="card" data-id={`home-card-${app.alias}`} style:--card-accent={accent}>
                <div class="badge">
                  <Icon icon={app.icon} size={'medium'} fill={accent} />
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
</div>

<style lang="scss">
  // Las auras del .workbench-container quedan tapadas por el panel de contenido,
  // asi que Inicio pinta las suyas. `fixed` para que no viajen con el scroll.
  .home-aura {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
    background-image: var(--wiwo-aura);
    background-attachment: fixed;
  }
  .home {
    margin: 0 auto;
    max-width: 64rem;
    width: 100%;
    padding-inline: 1rem;
  }
  // El degradé de marca en movimiento, compartido por el nombre y el filete.
  @keyframes wiwo-gradient-shift {
    from {
      background-position: 0% 50%;
    }
    to {
      background-position: 100% 50%;
    }
  }
  .greeting {
    margin: 0;
    font-family: var(--font-brand);
    font-size: clamp(1.75rem, 7vw, 3rem);
    font-weight: 700;
    line-height: 1.1;
    letter-spacing: -0.015em;
    color: var(--global-primary-TextColor);

    .accent {
      background-image: var(--wiwo-gradient-flow);
      background-size: 220% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      color: transparent;
      animation: wiwo-gradient-shift 6s var(--wiwo-ease-emphasized) infinite alternate;
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
    width: clamp(4rem, 20vw, 7.5rem);
    height: 0.25rem;
    border-radius: var(--min-BorderRadius);
    background-image: var(--wiwo-gradient-flow);
    background-size: 220% 100%;
    animation: wiwo-gradient-shift 6s var(--wiwo-ease-emphasized) infinite alternate;
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
    transition:
      border-color var(--wiwo-motion-fast) var(--wiwo-ease-expressive),
      box-shadow var(--wiwo-motion-fast) var(--wiwo-ease-expressive),
      transform var(--wiwo-motion-fast) var(--wiwo-ease-expressive);

    // La tarjeta no se tiñe: sólo se marca el borde con el color de su ícono y
    // suelta un halo suave. El borde va al 55% del acento y sin anillo extra:
    // a color pleno y con anillo de 3px el contorno se leía fosforescente.
    &:hover {
      border-color: color-mix(in srgb, var(--card-accent) 55%, transparent);
      box-shadow: 0 8px 24px -14px color-mix(in srgb, var(--card-accent) 45%, transparent);
      transform: translateY(-2px);
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
    background-color: color-mix(in srgb, var(--card-accent) 14%, transparent);
  }
  :global(a:focus-visible) .card {
    outline: 2px solid var(--global-focus-BorderColor);
    outline-offset: 2px;
  }
  @media (prefers-reduced-motion: reduce) {
    .greeting .accent,
    .rule {
      animation: none;
      background-position: 50% 50%;
    }
    .card {
      transition: none;

      &:hover {
        transform: none;
      }
    }
  }
</style>
