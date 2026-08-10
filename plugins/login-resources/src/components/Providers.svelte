<script lang="ts">
  import { concatLink } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import { type ProviderInfo } from '@hcengineering/account-client'
  import { AnySvelteComponent, getCurrentLocation } from '@hcengineering/ui'
  import { Analytics } from '@hcengineering/analytics'
  import { onMount } from 'svelte'
  import login from '../plugin'
  import { getProviders } from '../utils'
  import Github from './providers/Github.svelte'
  import Google from './providers/Google.svelte'
  import OpenId from './providers/OpenId.svelte'

  interface Provider {
    name: string
    component: AnySvelteComponent
    displayName?: string
  }

  const providerMap: Record<string, AnySvelteComponent> = {
    google: Google,
    github: Github,
    openid: OpenId
  }

  /**
   * Indica si el backend devolvio algun proveedor habilitado. Se expone para que
   * quien monte este componente pueda ocultar separadores o titulos cuando no hay
   * ninguno (sin credenciales de Google, `getProviders()` devuelve `[]`).
   */
  export let hasProviders: boolean = false

  let enabledProviders: Provider[] = []

  $: hasProviders = enabledProviders.length > 0

  onMount(() => {
    void getProviders().then((res: ProviderInfo[]) => {
      enabledProviders = res.map((provider) => {
        const component = providerMap[provider.name]
        return {
          ...provider,
          component
        }
      })
    })
  })

  const location = getCurrentLocation()

  function getLink (provider: Provider): string {
    const inviteId = location.query?.inviteId
    const autoJoin = location.query?.autoJoin !== undefined
    const navigateUrl = location.query?.navigateUrl
    const accountsUrl = getMetadata(login.metadata.AccountsUrl) ?? ''
    let path = `/auth/${provider.name}`
    if (inviteId != null) {
      path += `?inviteId=${inviteId}`
      if (autoJoin) {
        path += '&autoJoin'
      }
      if (navigateUrl != null) {
        path += `&navigateUrl=${navigateUrl}`
      }
    }

    return concatLink(accountsUrl, path)
  }

  function handleProviderClick (provider: Provider): void {
    const currentPath = location.path[1]
    const isSignUp = currentPath === 'signup'
    const isJoin = currentPath === 'join'
    const eventPrefix = isSignUp || isJoin ? 'signup' : 'login'
    const eventName: string = `${eventPrefix}.${provider.name}.started`

    Analytics.handleEvent(eventName)
  }
</script>

{#if hasProviders}
  <div class="container">
    {#each enabledProviders as provider}
      <a
        class="provider-button"
        href={getLink(provider)}
        on:click={() => {
          handleProviderClick(provider)
        }}
      >
        <svelte:component this={provider.component} displayName={provider.displayName} />
      </a>
    {/each}
  </div>
{/if}

<style lang="scss">
  // Se conserva la separacion superior que tenia el componente para no alterar
  // signup, join y ProvidersOnlyForm, que lo montan debajo de otro contenido.
  .container {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  // Accion primaria a ancho completo: mismo alto y radio que el boton
  // `x-large` / `round2` del formulario, pero con la superficie clara que exige
  // la guia de marca de Google para el boton de acceso.
  .provider-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 2.75rem;
    padding: 0 1rem;
    font-weight: 500;
    font-size: 0.875rem;
    color: #1f1f1f;
    background-color: #ffffff;
    border: 1px solid rgba(31, 31, 31, 0.16);
    border-radius: var(--medium-BorderRadius);
    box-shadow: 0 8px 24px rgba(66, 66, 255, 0.18);
    text-decoration: none;
    transition:
      background-color 0.15s var(--timing-main),
      box-shadow 0.15s var(--timing-main);

    &:hover {
      background-color: #f5f5f5;
      box-shadow: 0 10px 28px rgba(66, 66, 255, 0.26);
    }
    &:active {
      background-color: #ececec;
      box-shadow: 0 4px 12px rgba(66, 66, 255, 0.18);
    }
    &:focus-visible {
      outline: 2px solid var(--primary-button-focused-border, #4242ff);
      outline-offset: 2px;
    }
  }
</style>
