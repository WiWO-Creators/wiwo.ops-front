<!--
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
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
  import {
    WorkspaceInfoWithStatus,
    isActiveMode,
    isArchivingMode,
    isRestoringMode,
    isUpgradingMode
  } from '@hcengineering/core'
  import { LoginInfo, type JoinableWorkspace } from '@hcengineering/login'
  import platform, { getMetadata, OK, Severity, Status } from '@hcengineering/platform'
  import presentation, { MessageBox, NavLink, isAdminUser, reduceCalls } from '@hcengineering/presentation'
  import {
    Button,
    Label,
    Scroller,
    SearchEdit,
    Spinner,
    deviceOptionsStore as deviceInfo,
    showPopup,
    ticker
  } from '@hcengineering/ui'
  import { logOut } from '@hcengineering/workbench'
  import { onMount } from 'svelte'

  import login from '../plugin'
  import {
    getAccount,
    getAccountDisplayName,
    getHref,
    getWorkspaces,
    goTo,
    isReadOnlyGuestAccount,
    joinByToken,
    navigateToWorkspace,
    selectWorkspace,
    unArchive
  } from '../utils'
  import StatusControl from './StatusControl.svelte'

  export let navigateUrl: string | undefined = undefined

  let workspaces: WorkspaceInfoWithStatus[] = []
  let status = OK
  let accountPromise: Promise<LoginInfo | null>
  let account: LoginInfo | null | undefined = undefined
  let isReadOnlyGuest: boolean = true

  let flagToUpdateWorkspaces = false
  let joining: string | undefined = undefined

  // Workspaces abiertos que se configuran por despliegue: se ofrecen a quien todavía no es miembro,
  // para que entre solo en vez de tener que pedir que lo inviten a mano.
  // Se descartan las entradas sin invitación configurada: el botón no llevaría a ningún lado.
  const joinable: JoinableWorkspace[] = (getMetadata(login.metadata.JoinableWorkspaces) ?? []).filter(
    (j) => j.url !== '' && j.inviteId !== ''
  )
  $: available = joinable.filter((j) => !workspaces.some((w) => w.url === j.url))

  /** Suma a la persona al workspace elegido y la lleva adentro. */
  async function join (workspace: JoinableWorkspace): Promise<void> {
    if (joining !== undefined) return
    joining = workspace.url
    try {
      const result = await joinByToken(workspace.inviteId)
      navigateToWorkspace(workspace.url, result, navigateUrl)
    } catch (err: any) {
      // El error de la plataforma ya trae un mensaje entendible; si no, se muestra el crudo.
      status = err?.status ?? new Status(Severity.ERROR, platform.status.UnknownError, { message: err.message })
      joining = undefined
    }
  }

  async function loadAccount (): Promise<void> {
    accountPromise = getAccount()
    account = await accountPromise
    isReadOnlyGuest = await isReadOnlyGuestAccount(account)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const updateWorkspaces = reduceCalls(async function updateWorkspaces (_time?: number): Promise<void> {
    try {
      workspaces = await getWorkspaces()
    } catch (e) {
      // we should be able to continue from this state
    }
  })

  $: if (flagToUpdateWorkspaces) {
    void updateWorkspaces($ticker)
  }

  onMount(() => {
    void loadAccount()
  })

  async function select (workspaceUrl: string): Promise<void> {
    status = new Status(Severity.INFO, login.status.ConnectingToServer, {})

    const [loginStatus, result] = await selectWorkspace(workspaceUrl)

    const ws = workspaces.find((it) => it.uuid === result?.workspace)
    if (ws != null && isArchivingMode(ws?.mode) && result?.workspace !== undefined) {
      showPopup(MessageBox, {
        label: login.string.SelectWorkspace,
        message: login.string.WorkspaceArchivedDesc,
        canSubmit: true,
        params: {},
        okLabel: login.string.RestoreArchivedWorkspace,
        action: async () => {
          if (await unArchive(ws.uuid, result.token)) {
            workspaces = await getWorkspaces()
            let info = workspaces.find((it) => it.uuid === ws.uuid)
            while (isRestoringMode(info?.mode) || isUpgradingMode(info?.mode)) {
              await new Promise<void>((resolve) => setTimeout(resolve, 5000))
              workspaces = await getWorkspaces()
              info = workspaces.find((it) => it.uuid === ws.uuid)
            }
          }
        }
      })
      status = loginStatus
      return
    }
    status = loginStatus

    navigateToWorkspace(workspaceUrl, result, navigateUrl)
  }

  async function _getWorkspaces (): Promise<void> {
    try {
      const res = await getWorkspaces()

      await accountPromise
      if (res.length === 0 && account?.token == null) {
        goTo('confirmationSend')
      }

      workspaces = res
      await updateWorkspaces()
      flagToUpdateWorkspaces = true
    } catch (err: any) {
      await logOut()
      goTo('login')
      throw err
    }
  }
  let search: string = ''
</script>

<form class="container" style:padding={$deviceInfo.docWidth <= 480 ? '1.25rem' : '5rem'}>
  <div class="grow-separator" />
  <div class="fs-title">
    {#if account != null}
      {getAccountDisplayName(account)}
    {:else}
      <Label label={login.string.LoadingAccount} />
    {/if}
  </div>
  <div class="title"><Label label={login.string.SelectWorkspace} /></div>
  <div class="status">
    <StatusControl {status} />
  </div>
  {#if workspaces.length > 10}
    <div class="ml-2 mr-2 mb-2 flex-grow">
      <SearchEdit bind:value={search} width={'100%'} />
    </div>
  {/if}
  {#await _getWorkspaces()}
    <div class="workspace-loader">
      <Spinner />
    </div>
  {:then}
    <Scroller padding={'.125rem 0'} maxHeight={35}>
      {#if workspaces.length === 0 && account?.token != null && isReadOnlyGuest}
        <span class="readonly-warning"><Label label={login.string.SignUpToCreateWorkspace} /></span>
      {/if}
      <div class="form">
        {#each workspaces
          .filter((it) => search === '' || (it.name?.includes(search) ?? false) || it.url.includes(search))
          .slice(0, 500) as workspace}
          {@const wsName = workspace.name ?? workspace.url}
          {@const neverVisited = workspace.lastVisit === undefined || workspace.lastVisit === 0}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="workspace cursor-pointer focused-button bordered form-row"
            on:click={() => select(workspace.url)}
          >
            <span class="initial">{wsName.charAt(0).toUpperCase()}</span>
            <span class="name overflow-label">
              {wsName}
              {#if isArchivingMode(workspace.mode)}
                - <Label label={presentation.string.Archived} />
              {/if}
              {#if !isActiveMode(workspace.mode) && !isArchivingMode(workspace.mode)}
                ({workspace.processingProgress}%)
              {/if}
            </span>
            {#if neverVisited}
              <span class="tag"><Label label={login.string.FirstVisit} /></span>
            {/if}
          </div>
        {/each}

        {#if isReadOnlyGuest && workspaces.length === 0 && account?.token != null}
          <div class="form-row send">
            <Button
              label={login.string.SignUp}
              kind={'primary'}
              width="100%"
              on:click={() => {
                goTo('signup')
              }}
            />
          </div>
        {:else if available.length > 0}
          <div class="section-title form-row" class:first={workspaces.length === 0}>
            <Label label={login.string.AvailableWorkspaces} />
          </div>
          {#each available as workspace (workspace.url)}
            <div
              class="workspace available cursor-pointer focused-button bordered form-row"
              class:busy={joining !== undefined}
              role="button"
              tabindex="0"
              on:click={() => {
                void join(workspace)
              }}
              on:keydown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  void join(workspace)
                }
              }}
            >
              <span class="initial">{workspace.name.charAt(0).toUpperCase()}</span>
              <span class="name overflow-label">{workspace.name}</span>
              {#if joining === workspace.url}
                <Spinner size={'small'} />
              {:else}
                <span class="tag join"><Label label={login.string.Join} /></span>
              {/if}
            </div>
          {/each}
        {:else if workspaces.length === 0 && account?.token != null}
          <span class="readonly-warning"><Label label={login.string.NoWorkspaceAccess} /></span>
        {/if}
      </div>
    </Scroller>
    <div class="grow-separator" />
    <div class="footer">
      <div>
        <span><Label label={login.string.NotSeeingWorkspace} /></span>
        <NavLink
          href={getHref('login')}
          onClick={async () => {
            await logOut()
            goTo('login')
          }}
        >
          <Label label={login.string.ChangeAccount} />
        </NavLink>
      </div>
    </div>
  {/await}
</form>

<style lang="scss">
  .container {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    flex-grow: 1;
    overflow: hidden;

    .workspace-loader {
      height: 100%;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .title {
      font-weight: 600;
      font-size: 1.5rem;
      color: var(--theme-caption-color);
    }
    // Sin mensaje que mostrar, el bloque de estado dejaba un hueco fijo enorme entre el título
    // y la lista. Ahora sólo ocupa lo que necesita.
    .status {
      min-height: 2.5rem;
      max-height: 7.5rem;
      padding-top: 1.25rem;
    }

    .form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      column-gap: 0.75rem;
      // Ritmo cerrado dentro de cada grupo; la separación entre grupos la pone el encabezado.
      row-gap: 0.75rem;

      .form-row {
        grid-column-start: 1;
        grid-column-end: 3;
      }

      .workspace {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem 1rem;
        border-radius: 0.75rem;

        // La inicial da un punto de anclaje al ojo cuando hay varias filas iguales.
        .initial {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          width: 2rem;
          height: 2rem;
          border-radius: 0.5rem;
          background-color: var(--theme-button-hovered);
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--theme-caption-color);
        }
        .name {
          flex-grow: 1;
          min-width: 0;
          text-align: left;
          font-size: 1rem;
          font-weight: 500;
          color: var(--theme-caption-color);
        }
        .tag {
          flex-shrink: 0;
          font-size: 0.75rem;
          color: var(--theme-dark-color);
        }
      }
      // Los espacios a los que todavía no pertenece pesan menos que los propios, pero se
      // manejan igual: misma tarjeta, mismo gesto.
      // Los espacios a los que todavía no pertenece pesan menos que los propios, pero se
      // manejan igual: misma tarjeta, mismo gesto.
      .workspace.available {
        border-style: dashed;

        .initial {
          background-color: transparent;
          border: 1px dashed var(--theme-divider-color);
          color: var(--theme-dark-color);
        }
        .name {
          font-weight: 400;
          color: var(--theme-content-color);
        }
        .tag.join {
          color: var(--theme-caption-color);
        }
        &.busy {
          pointer-events: none;
          opacity: 0.6;
        }
      }
      .section-title {
        margin-top: 1.25rem;
        font-size: 0.75rem;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--theme-dark-color);

        &.first {
          margin-top: 0;
        }
      }
    }
    .readonly-warning {
      margin-bottom: 1.5rem;
      color: var(--theme-caption-color);
    }
    .grow-separator {
      flex-grow: 1;
    }
    .footer {
      margin-top: 3.5rem;
      font-size: 0.8rem;
      color: var(--theme-caption-color);
      span {
        opacity: 0.8;
      }
      a {
        text-decoration: none;
        color: var(--theme-caption-color);
        opacity: 0.8;
        &:hover {
          opacity: 1;
        }
      }
    }
  }
</style>
