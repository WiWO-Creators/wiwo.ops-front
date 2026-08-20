//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2023 Hardcore Engineering Inc.
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
//

import { getClient as getAccountClient } from '@hcengineering/account-client'
import type {
  Account,
  Class,
  Client,
  Doc,
  ModulePermissionGroup,
  Ref,
  Space,
  TxOperations,
  WorkspaceInfoWithStatus
} from '@hcengineering/core'
import core, { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getMetadata, getResource, setMetadata } from '@hcengineering/platform'
import presentation, { closeClient, getClient, setPresentationCookie } from '@hcengineering/presentation'
import {
  closePanel,
  getCurrentLocation,
  type Location,
  location,
  navigate,
  setMetadataLocalStorage
} from '@hcengineering/ui'
import view from '@hcengineering/view'
import workbench, { homeId, type Application, type NavigatorModel } from '@hcengineering/workbench'
import { derived, writable } from 'svelte/store'

/**
 * La aplicación Inicio, declarada desde el front.
 *
 * El servicio `workspace` corre la imagen upstream (backend/wiwo.ops/compose.yml), así que los
 * documentos de modelo que agrega el fork nunca llegan a la base del workspace: sin esto, en
 * producción no existe el `Application` de Inicio, la barra lateral no lo muestra y la URL del
 * módulo queda en blanco. Los valores repiten los de models/workbench/src/index.ts y conservan el
 * mismo `_id`, de modo que el día que `workspace` se construya desde el fork el documento real
 * ocupe su lugar sin duplicar la entrada ni perder las preferencias del usuario.
 */
const homeApplication: Application = {
  _id: 'workbench:app:Home' as Ref<Application>,
  _class: workbench.class.Application,
  space: core.space.Model,
  modifiedBy: core.account.System,
  modifiedOn: 0,
  label: workbench.string.HomeTitle,
  icon: workbench.icon.Home,
  alias: homeId,
  hidden: false,
  component: workbench.component.Home,
  position: 'top',
  order: 50
}

const localApplications: Application[] = [homeApplication]

/**
 * Completa las aplicaciones del modelo con las que declara el fork y el workspace todavía no
 * conoce.
 *
 * @param apps aplicaciones tal como vienen del modelo del workspace
 * @returns las mismas, más las locales que falten; el arreglo original si no falta ninguna
 */
export function withLocalApplications (apps: Application[]): Application[] {
  const missing = localApplications.filter((local) => !apps.some((app) => app.alias === local.alias))

  return missing.length === 0 ? apps : [...apps, ...missing]
}

/**
 * Busca por alias una aplicación declarada sólo en el front.
 *
 * @param alias alias de la aplicación, tal como aparece en la URL
 * @returns la aplicación local, o `undefined` si ese alias no es de una
 */
export function findLocalApplication (alias: string | undefined): Application | undefined {
  if (alias === undefined) return undefined

  return localApplications.find((app) => app.alias === alias)
}

export const workspaceCreating = writable<number | undefined>(undefined)

export function getSpecialSpaceClass (model: NavigatorModel): Array<Ref<Class<Space>>> {
  const spaceResult = model.spaces.map((x) => x.spaceClass)
  const result = (model.specials ?? [])
    .map((it) => it.spaceClass)
    .filter((it) => it !== undefined && !spaceResult.includes(it))
  return spaceResult.concat(result as Array<Ref<Class<Space>>>)
}

export async function getSpaceName (client: Client, space: Space): Promise<string> {
  const hierarchy = client.getHierarchy()
  const clazz = hierarchy.getClass(space._class)
  const nameMixin = hierarchy.as(clazz, view.mixin.SpaceName)

  if (nameMixin?.getName !== undefined) {
    const getSpaceName = await getResource(nameMixin.getName)
    const name = await getSpaceName(client, space)

    return name
  }

  return space.name
}

/**
 * @public
 */
export async function doNavigate (
  doc: Doc | Doc[],
  evt: Event | undefined,
  props: {
    mode: 'app' | 'special' | 'space'
    application?: string
    special?: string
    spaceSpecial?: string
    space?: Ref<Space>
    // If no space is selected, select first space from list
    spaceClass?: Ref<Class<Space>>
    query?: Record<string, string | null>
  }
): Promise<void> {
  evt?.preventDefault()

  closePanel()
  const loc = getCurrentLocation()
  const client = getClient()
  switch (props.mode) {
    case 'app':
      loc.path[2] = props.application ?? ''
      if (props.special !== undefined) {
        loc.path[3] = props.special
        loc.path.length = 4
      } else {
        loc.path.length = 3
      }
      loc.query = props.query
      loc.fragment = undefined
      navigate(loc)
      break
    case 'special':
      if (props.application !== undefined && loc.path[2] !== props.application) {
        loc.path[2] = props.application
      }
      loc.path[3] = props.special ?? ''
      loc.path.length = 4
      loc.query = props.query
      loc.fragment = undefined
      navigate(loc)
      break
    case 'space': {
      if (props.space !== undefined) {
        loc.path[3] = props.space
      } else {
        if (doc !== undefined && !Array.isArray(doc) && client.getHierarchy().isDerived(doc._class, core.class.Space)) {
          loc.path[3] = doc._id
        }
      }
      if (props.spaceSpecial !== undefined) {
        loc.path[4] = props.spaceSpecial
      }
      if (props.spaceClass !== undefined) {
        const ex = await client.findOne(props.spaceClass, { _id: loc.path[3] as Ref<Space> })
        if (ex === undefined) {
          const r = await client.findOne(props.spaceClass, {})
          if (r !== undefined) {
            loc.path[3] = r._id
          }
        }
      }
      loc.path.length = 5
      loc.query = props.query
      loc.fragment = undefined
      navigate(loc)

      break
    }
  }
}

export function isAllowedToRole (role: AccountRole | undefined, acc: Account): boolean {
  if (role === undefined) return true
  return hasAccountRole(acc, role)
}

/**
 * Aplicaciones que el usuario actual puede ver.
 *
 * Descarta las declaradas como ocultas, las excluidas por el despliegue, las que piden un rol
 * superior al suyo, las ocultadas por preferencia, las vedadas a invitados y las de módulos
 * apagados en el workspace.
 *
 * @param apps aplicaciones candidatas (normalmente todas las del modelo)
 * @param hiddenAppsIds refs de `workbench.class.HiddenApplication`; pasar `[]` en superficies que
 *   deben listar también las ocultas para poder reactivarlas (AppSwitcher)
 * @param disabledApps refs de aplicaciones con `ModulePermissionGroup` deshabilitado
 * @returns las aplicaciones visibles, en el orden recibido
 */
export function filterVisibleApplications (
  apps: Application[],
  hiddenAppsIds: Array<Ref<Application>> = [],
  disabledApps: Set<Ref<Application>> = new Set<Ref<Application>>()
): Application[] {
  const me = getCurrentAccount()
  const excludedIds = getMetadata(workbench.metadata.ExcludedApplications) ?? []
  const excludedAliases =
    me.role === AccountRole.ReadOnlyGuest || me.role === AccountRole.Guest
      ? getMetadata(workbench.metadata.ExcludedApplicationsForAnonymous) ?? []
      : []

  return apps.filter(
    (app) =>
      !app.hidden &&
      !excludedIds.includes(app._id) &&
      isAllowedToRole(app.accessLevel, me) &&
      !hiddenAppsIds.includes(app._id) &&
      !excludedAliases.includes(app.alias) &&
      !disabledApps.has(app._id)
  )
}

/**
 * Traduce los grupos de permisos de módulo a las aplicaciones apagadas para el rol actual.
 * @param groups documentos `core.class.ModulePermissionGroup` del workspace
 * @returns refs de las aplicaciones que no deben ofrecerse al usuario actual
 */
export function getDisabledApplications (groups: ModulePermissionGroup[]): Set<Ref<Application>> {
  const role = getCurrentAccount().role

  return new Set<Ref<Application>>(
    groups
      .filter((g) => {
        if (g.enabled ?? true) return false
        if (role === g.role) return true
        // DocGuest hereda los módulos apagados para Guest.
        return role === AccountRole.DocGuest && g.role === AccountRole.Guest
      })
      .map((g) => g.application as Ref<Application>)
  )
}

export async function hideApplication (app: Application): Promise<void> {
  const client = getClient()

  await client.createDoc(workbench.class.HiddenApplication, core.space.Workspace, {
    attachedTo: app._id
  })
}

export async function showApplication (app: Application): Promise<void> {
  const client = getClient()

  const current = await client.findOne(workbench.class.HiddenApplication, { attachedTo: app._id })
  if (current !== undefined) {
    await client.remove(current)
  }
}

export const workspacesStore = writable<WorkspaceInfoWithStatus[]>([])
export const locationWorkspaceStore = derived(location, (loc: Location) => loc.path[1])
export const currentWorkspaceStore = derived(
  [workspacesStore, locationWorkspaceStore],
  ([$workspaces, $locationWorkspace]) => {
    return $workspaces.find((it) => it.url === $locationWorkspace)
  }
)

/**
 * @public
 */
export async function buildNavModel (
  client: TxOperations,
  currentApplication?: Application
): Promise<NavigatorModel | undefined> {
  let newNavModel = currentApplication?.navigatorModel
  if (currentApplication !== undefined) {
    const models = await client.findAll(workbench.class.ApplicationNavModel, { extends: currentApplication._id })
    for (const nm of models) {
      const spaces = newNavModel?.spaces ?? []
      // Check for extending
      for (const sp of spaces) {
        const extend = (nm.spaces ?? []).find((p) => p.id === sp.id)
        if (extend !== undefined) {
          sp.label = sp.label ?? extend.label
          sp.createComponent = sp.createComponent ?? extend.createComponent
          sp.addSpaceLabel = sp.addSpaceLabel ?? extend.addSpaceLabel
          sp.icon = sp.icon ?? extend.icon
          sp.visibleIf = sp.visibleIf ?? extend.visibleIf
          sp.specials = [...(sp.specials ?? []), ...(extend.specials ?? [])]
        }
      }
      const newSpaces = (nm.spaces ?? []).filter((it) => !spaces.some((sp) => sp.id === it.id))
      newNavModel = {
        spaces: [...spaces, ...newSpaces],
        specials: [...(newNavModel?.specials ?? []), ...(nm.specials ?? [])]
      }
    }
  }
  return newNavModel
}

export async function logIn (loginInfo: { account: string, token?: string }): Promise<void> {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  await getAccountClient(accountsUrl, loginInfo.token).setCookie()

  setMetadata(presentation.metadata.Token, loginInfo.token)
  setMetadataLocalStorage(login.metadata.LastAccount, loginInfo.account)
  setMetadataLocalStorage(login.metadata.LoginAccount, loginInfo.account)
}

export async function logOut (): Promise<void> {
  const accountsUrl = getMetadata(login.metadata.AccountsUrl)
  try {
    await getAccountClient(accountsUrl).deleteCookie()
  } catch (error) {}

  const currentWorkspace = getMetadata(presentation.metadata.WorkspaceUuid)
  if (currentWorkspace !== undefined) {
    setPresentationCookie('', currentWorkspace)
  }

  setMetadata(presentation.metadata.Token, null)
  setMetadata(presentation.metadata.WorkspaceUuid, null)
  setMetadata(presentation.metadata.WorkspaceDataId, null)
  setMetadataLocalStorage(login.metadata.LoginEndpoint, null)
  setMetadataLocalStorage(login.metadata.LoginAccount, null)

  void closeClient()
}
