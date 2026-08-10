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
  import { getMetadata, setMetadata, Severity, Status } from '@hcengineering/platform'
  import presentation from '@hcengineering/presentation'
  import {
    Label,
    Location,
    Popup,
    Scroller,
    ThinkingOrb,
    deviceOptionsStore as deviceInfo,
    fetchMetadataLocalStorage,
    getCurrentLocation,
    location,
    setMetadataLocalStorage
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import Auth from './Auth.svelte'
  import Confirmation from './Confirmation.svelte'
  import ConfirmationSend from './ConfirmationSend.svelte'
  import CreateWorkspaceForm from './CreateWorkspaceForm.svelte'
  import Join from './Join.svelte'
  import AutoJoin from './AutoJoin.svelte'
  import LoginForm from './LoginForm.svelte'
  import ProvidersOnlyForm from './ProvidersOnlyForm.svelte'
  import PasswordRequest from './PasswordRequest.svelte'
  import PasswordRestore from './PasswordRestore.svelte'
  import SelectWorkspace from './SelectWorkspace.svelte'
  import SignupForm from './SignupForm.svelte'
  import LoginTfaForm from './LoginTfaForm.svelte'
  import LoginIcon from './icons/LoginIcon.svelte'
  import { Pages, getAccount, pages } from '..'
  import login from '../plugin'

  import AdminWorkspaces from './AdminWorkspaces.svelte'
  import ChangePassword from './ChangePassword.svelte'
  import StatusControl from './StatusControl.svelte'

  export let page: Pages = 'signup'

  const signUpDisabled = getMetadata(login.metadata.DisableSignUp) ?? false
  const localLoginHidden = getMetadata(login.metadata.HideLocalLogin) ?? false
  const useOTP = getMetadata(presentation.metadata.MailUrl) != null && getMetadata(presentation.metadata.MailUrl) !== ''
  let navigateUrl: string | undefined
  let tfaToken: string | undefined = undefined
  let authError: string | undefined = undefined

  /** Paginas que solo tienen sentido con acceso local por correo y contrasena. */
  const localOnlyPages: Pages[] = ['signup', 'password', 'recovery']

  onDestroy(location.subscribe(updatePageLoc))

  function updatePageLoc (loc: Location): void {
    const token = getMetadata(presentation.metadata.Token)
    page = (loc.path[1] as Pages) ?? (token != null ? 'selectWorkspace' : 'login')
    if (page === 'join' && loc.query?.autoJoin !== undefined) {
      page = 'autoJoin'
    }

    const allowedUnauthPages: Pages[] = [
      'login',
      'signup',
      'password',
      'recovery',
      'join',
      'autoJoin',
      'confirm',
      'confirmationSend',
      'auth',
      'tfa'
    ]
    if (token === undefined ? !allowedUnauthPages.includes(page) : !pages.includes(page)) {
      const account = fetchMetadataLocalStorage(login.metadata.LastAccount)
      page = account != null ? 'login' : 'signup'
    }

    // Sin acceso local no hay alta ni recuperacion de contrasena que valga:
    // esas paginas se montaban enteras aunque el formulario estuviera oculto.
    if (localLoginHidden && localOnlyPages.includes(page)) {
      page = 'login'
    }

    navigateUrl = loc.query?.navigateUrl ?? undefined
    tfaToken = loc.query?.token ?? undefined
    authError = loc.query?.authError ?? undefined
  }

  async function chooseToken (): Promise<void> {
    if (page === 'auth') {
      // token handled by auth page
      return
    } else if (page === 'autoJoin') {
      // there's a separate workflow for auto join
      return
    }

    if (getMetadata(presentation.metadata.Token) == null) {
      const lastAccount = fetchMetadataLocalStorage(login.metadata.LastAccount)
      if (lastAccount != null) {
        try {
          const loginInfo = await getAccount(false)
          if (loginInfo != null) {
            setMetadata(presentation.metadata.Token, loginInfo.token)
            setMetadataLocalStorage(login.metadata.LoginAccount, loginInfo.account)
            updatePageLoc(getCurrentLocation())
          }
        } catch (err: any) {
          // do nothing
        }
      }
    }
  }

  onMount(chooseToken)

  // Bajo 768px el panel de marca no cabe: el wordmark se muda a la tarjeta.
  $: compacto = $deviceInfo.docWidth <= 768

  // El proveedor devuelve el motivo del rechazo en la URL para poder explicarlo.
  $: authStatus =
    authError === undefined
      ? undefined
      : new Status(
        Severity.ERROR,
        authError === 'domain' ? login.status.AuthDomainNotAllowed : login.status.AuthProviderFailed,
        {}
      )
</script>

{#if page === 'admin'}
  <AdminWorkspaces />
{:else}
  <!--
    El login es una pieza de marca: se fuerza el tema oscuro sin importar la
    preferencia del usuario, por eso el wordmark es siempre el crema.
  -->
  <div class="theme-dark login-shell" class:compact={compacto}>
    {#if !compacto}
      <aside class="brand-pane">
        <div class="brand-orb" aria-hidden="true">
          <ThinkingOrb cssSize={'clamp(14rem, 26vw, 21rem)'} />
        </div>
        <div class="brand-copy">
          <LoginIcon height={'2.25rem'} />
          <p class="tagline"><Label label={login.string.BrandTagline} /></p>
        </div>
      </aside>
    {/if}

    <main class="form-pane">
      <div class="card">
        {#if compacto}
          <div class="card-brand"><LoginIcon /></div>
        {/if}
        <Scroller padding={'0'}>
          <div class="form-content">
            {#if authStatus !== undefined}
              <div class="auth-error"><StatusControl status={authStatus} /></div>
            {/if}
            {#if page === 'login'}
              {#if localLoginHidden}
                <ProvidersOnlyForm />
              {:else}
                <LoginForm {navigateUrl} {signUpDisabled} {useOTP} />
              {/if}
            {:else if page === 'signup'}
              <SignupForm {navigateUrl} {signUpDisabled} {localLoginHidden} {useOTP} />
            {:else if page === 'createWorkspace'}
              <CreateWorkspaceForm />
            {:else if page === 'password'}
              <PasswordRequest {signUpDisabled} />
            {:else if page === 'recovery'}
              <PasswordRestore />
            {:else if page === 'selectWorkspace'}
              <SelectWorkspace {navigateUrl} />
            {:else if page === 'join'}
              <Join />
            {:else if page === 'autoJoin'}
              <AutoJoin />
            {:else if page === 'confirm'}
              <Confirmation />
            {:else if page === 'confirmationSend'}
              <ConfirmationSend />
            {:else if page === 'auth'}
              <Auth />
            {:else if page === 'changePassword'}
              <ChangePassword />
            {:else if page === 'tfa'}
              <LoginTfaForm {navigateUrl} token={tfaToken} on:back={() => (page = 'login')} />
            {/if}
          </div>
        </Scroller>
      </div>
    </main>

    <Popup />
  </div>
{/if}

<style lang="scss">
  // Alias locales sobre los tokens Neo (mismo patron que ThinkingOrb.svelte):
  // un solo sitio donde cambiar la marca, y fallback si el tema no cargo.
  .login-shell {
    --login-ink: var(--wiwo-ink, #292929);
    --login-blue: var(--wiwo-blue, #4242ff);
    --login-green: var(--wiwo-green, #3bff00);
    --login-beige: var(--wiwo-beige, #f8fad7);
    --login-purple: var(--wiwo-purple, #8d7cff);
    --login-ease: var(--wiwo-ease-expressive, cubic-bezier(0.2, 0.8, 0.2, 1));
    --login-motion: var(--wiwo-motion-medium, 280ms);
    // Respiro interior de la tarjeta: el unico dueno del padding del formulario.
    --login-card-padding: 2.5rem;

    position: relative;
    display: grid;
    grid-template-columns: 1fr min(36rem, 44%);
    width: 100%;
    height: 100%;
    background-color: var(--login-ink);
    // Fondo Neo por CSS: gradiente de marca en diagonal mas dos halos suaves.
    background-image:
      radial-gradient(
        55% 45% at 16% 10%,
        color-mix(in srgb, var(--login-beige) 10%, transparent) 0%,
        transparent 70%
      ),
      radial-gradient(
        70% 60% at 88% 88%,
        color-mix(in srgb, var(--login-green) 12%, transparent) 0%,
        transparent 65%
      ),
      linear-gradient(135deg, var(--login-ink) 0%, var(--login-blue) 76%, var(--login-green) 128%);
    background-attachment: fixed;
  }

  .brand-pane {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 4rem 3rem 4rem 4rem;
    min-width: 0;
    overflow: hidden;
  }
  // El orb es marca ambiental: ocupa el vacio a la derecha del texto, no se
  // pone detras, para no comerle contraste al tagline.
  .brand-orb {
    position: absolute;
    top: 50%;
    right: 4%;
    opacity: 0.6;
    transform: translateY(-50%);
    pointer-events: none;
  }
  .brand-copy {
    position: relative;
    max-width: 32rem;
  }
  .tagline {
    margin: 1.5rem 0 0;
    max-width: 28ch;
    font-family: var(--font-brand);
    font-size: 1.75rem;
    font-weight: 500;
    line-height: 1.25;
    letter-spacing: -0.015em;
    color: var(--theme-caption-color);
    text-wrap: balance;
  }

  .form-pane {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 2.5rem;
    min-width: 0;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: var(--login-card-padding);
    width: 100%;
    max-width: 30rem;
    max-height: 100%;
    background: color-mix(in srgb, var(--login-ink) 62%, transparent);
    // Upstream traia blur(157.855px): a partir de ~40px no cambia nada y cuesta GPU.
    backdrop-filter: blur(24px) saturate(1.4);
    border-radius: var(--large-BorderRadius, 1rem);
    box-shadow: 0 1.5rem 4rem color-mix(in srgb, var(--login-blue) 24%, transparent);
    animation: card-in var(--login-motion) var(--login-ease) both;

    // Borde de 1px pintado con un gradiente conico enmascarado.
    &::before {
      position: absolute;
      content: '';
      inset: 0;
      padding: 1px;
      background: conic-gradient(
          color-mix(in srgb, var(--login-beige) 18%, transparent) 10%,
          color-mix(in srgb, var(--login-purple) 50%, transparent),
          color-mix(in srgb, var(--login-blue) 46%, transparent),
          color-mix(in srgb, var(--login-beige) 32%, transparent),
          color-mix(in srgb, var(--login-green) 26%, transparent) 70%,
          color-mix(in srgb, var(--login-beige) 18%, transparent) 90%
        )
        border-box;
      -webkit-mask:
        linear-gradient(#000 0 0) content-box,
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor;
      mask-composite: exclude;
      border-radius: inherit;
      opacity: 0.7;
      pointer-events: none;
    }
  }
  .card-brand {
    display: flex;
    justify-content: center;
    margin-bottom: 2rem;
  }
  .auth-error {
    margin-bottom: 1.5rem;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(0.75rem);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .form-content {
    display: flex;
    flex-direction: column;
    justify-content: center;
    flex-grow: 1;
    height: max-content;
  }

  // El orb solo aparece cuando hay ancho de sobra: por debajo estorba y cuesta GPU.
  @media (max-width: 1024px) {
    .login-shell {
      grid-template-columns: 1fr min(30rem, 52%);
    }
    .brand-pane {
      padding: 3rem 2rem;
    }
    .brand-orb {
      display: none;
    }
    .tagline {
      font-size: 1.375rem;
    }
  }

  // Movil: una sola columna. El fondo Neo se mantiene (antes se perdia).
  .login-shell.compact {
    grid-template-columns: 1fr;
    --login-card-padding: 1.5rem;
    background-attachment: scroll; // `fixed` provoca jank de scroll en iOS.

    .form-pane {
      padding: 1.5rem 1rem;
      align-items: flex-start;
    }
    .card {
      max-width: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card {
      animation: none;
    }
    .brand-orb {
      display: none;
    }
  }
</style>
