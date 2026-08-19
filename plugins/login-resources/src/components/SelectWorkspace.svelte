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

  // Una sola lista con todo lo que la persona puede abrir: primero los espacios de los que ya
  // forma parte, después aquellos a los que puede sumarse. La diferencia se cuenta en la tarjeta,
  // no separando la lista en dos.
  $: entries = [
    ...workspaces.map((w) => ({
      url: w.url,
      name: w.name ?? w.url,
      member: true,
      workspace: w,
      invite: undefined as JoinableWorkspace | undefined
    })),
    ...available.map((j) => ({
      url: j.url,
      name: j.name,
      member: false,
      workspace: undefined as WorkspaceInfoWithStatus | undefined,
      invite: j
    }))
  ].filter((e) => search === '' || e.name.includes(search) || e.url.includes(search))

  /** Abre el espacio elegido: entra directo si ya es miembro, o se suma primero si no lo es. */
  async function open (entry: { member: boolean, url: string, invite?: JoinableWorkspace }): Promise<void> {
    if (entry.member) {
      await select(entry.url)
    } else if (entry.invite !== undefined) {
      await join(entry.invite)
    }
  }

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
        {#each entries.slice(0, 500) as entry (entry.url)}
          {@const ws = entry.workspace}
          {@const neverVisited = ws !== undefined && (ws.lastVisit === undefined || ws.lastVisit === 0)}
          <div
            class="workspace cursor-pointer focused-button bordered form-row"
            class:available={!entry.member}
            class:busy={!entry.member && joining !== undefined}
            role="button"
            tabindex="0"
            on:click={() => {
              void open(entry)
            }}
            on:keydown={(ev) => {
              if (ev.key === 'Enter' || ev.key === ' ') {
                ev.preventDefault()
                void open(entry)
              }
            }}
          >
            <span class="initial">{entry.name.charAt(0).toUpperCase()}</span>
            <span class="body">
              <span class="name overflow-label">
                {entry.name}
                {#if ws !== undefined && isArchivingMode(ws.mode)}
                  - <Label label={presentation.string.Archived} />
                {/if}
                {#if ws !== undefined && !isActiveMode(ws.mode) && !isArchivingMode(ws.mode)}
                  ({ws.processingProgress}%)
                {/if}
              </span>
              {#if !entry.member}
                <span class="hint"><Label label={login.string.JoinThisWorkspace} /></span>
              {:else if neverVisited}
                <span class="hint"><Label label={login.string.FirstVisit} /></span>
              {/if}
            </span>
            {#if joining === entry.url}
              <Spinner size={'small'} />
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
        {:else if workspaces.length === 0 && available.length === 0 && account?.token != null}
          <!-- Solo cuando no hay nada que ofrecer: con espacios abiertos a los que unirse,
               decir que no hay acceso contradice la lista de arriba. -->
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
        // Nombre arriba y, debajo, la línea que dice qué pasa al abrirlo.
        .body {
          display: flex;
          flex-direction: column;
          flex-grow: 1;
          min-width: 0;
          text-align: left;
        }
        .name {
          min-width: 0;
          font-size: 1rem;
          font-weight: 500;
          color: var(--theme-caption-color);
        }
        .hint {
          margin-top: 0.125rem;
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
    }
    .readonly-warning {
      // Sin esto cae en una de las dos columnas del grid y el texto se parte en jirones.
      grid-column: 1 / 3;
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
