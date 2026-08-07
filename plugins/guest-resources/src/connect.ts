import { Analytics } from '@hcengineering/analytics'
import client from '@hcengineering/client'
import { setCurrentEmployee, type Employee } from '@hcengineering/contact'
import {
  ClientConnectEvent,
  setCurrentAccount,
  type Account,
  type Client,
  type PersonId,
  type Ref
} from '@hcengineering/core'
import login, { type WorkspaceLoginInfo } from '@hcengineering/login'
import { getMetadata, getResource, setMetadata } from '@hcengineering/platform'
import presentation, {
  refreshClient,
  setClient,
  setCommunicationClient,
  setPresentationCookie
} from '@hcengineering/presentation'
import { getCurrentLocation } from '@hcengineering/ui'
import { logOut } from '@hcengineering/workbench'
import { writable } from 'svelte/store'

export const versionError = writable<string | undefined>(undefined)
export const invalidError = writable<boolean>(false)

let _token: string | undefined
let _client: Client | undefined
let _clientSet: boolean = false

export async function connect (title: string): Promise<Client | undefined> {
  const loc = getCurrentLocation()
  const token = loc.query?.token
  const wsUrl = loc.path[1]
  if (wsUrl === undefined || token == null) {
    invalidError.set(true)
    return
  }

  const exchangeGuestToken = await getResource(login.function.ExchangeGuestToken)
  const exchangedToken = await exchangeGuestToken(token)

  const selectWorkspace = await getResource(login.function.SelectWorkspace)
  let workspaceLoginInfo: WorkspaceLoginInfo | undefined
  while (true) {
    const selectResult = await selectWorkspace(wsUrl, exchangedToken)
    if (!selectResult[2]) {
      // Connection error happen, wait and retry
      await new Promise((resolve) => setTimeout(resolve, 1000))
      continue
    }
    workspaceLoginInfo = selectResult[1]
    if (workspaceLoginInfo == null) {
      const err = `Error selecting workspace ${wsUrl}. There might be something wrong with the token. Please try to log in again.`
      console.error(err)
      // something went wrong with selecting workspace with the selected token
      Analytics.handleError(new Error(err))
      await logOut()
      invalidError.set(true)
      return
    }
    break
  }

  setPresentationCookie(exchangedToken, workspaceLoginInfo.workspace)

  setMetadata(presentation.metadata.Token, exchangedToken)
  setMetadata(presentation.metadata.WorkspaceUuid, workspaceLoginInfo.workspace)
  setMetadata(presentation.metadata.WorkspaceName, workspaceLoginInfo.name ?? workspaceLoginInfo.workspaceUrl)
  setMetadata(presentation.metadata.WorkspaceDataId, workspaceLoginInfo.workspaceDataId)
  setMetadata(presentation.metadata.Endpoint, workspaceLoginInfo.endpoint)

  if (_token !== exchangedToken && _client !== undefined) {
    await _client.close()
    _client = undefined
  }
  if (_client !== undefined) {
    return _client
  }
  _token = exchangedToken

  const clientFactory = await getResource(client.function.GetClient)
  _client = await clientFactory(exchangedToken, workspaceLoginInfo.endpoint, {
    onUpgrade: () => {
      location.reload()
    },
    onError: () => {
      void logOut().then(() => {
        invalidError.set(true)
      })
    },
    // We need to refresh all active live queries and clear old queries.
    onConnect: async (event: ClientConnectEvent, data: any) => {
      console.log('WorkbenchClient: onConnect', event)
      try {
        if (event === ClientConnectEvent.Connected) {
          setMetadata(presentation.metadata.SessionId, data)
        }
        if ((_clientSet && event === ClientConnectEvent.Connected) || event === ClientConnectEvent.Refresh) {
          void refreshClient(true)
        }

        if (event === ClientConnectEvent.Upgraded) {
          window.location.reload()
        }
      } catch (err) {
        console.error(err)
      }
    }
  })
  console.log('logging in as guest')

  const account = workspaceLoginInfo.account

  const me: Account = {
    uuid: account,
    role: workspaceLoginInfo.role,
    primarySocialId: '' as PersonId,
    socialIds: [],
    fullSocialIds: []
  }

  const data: Record<string, any> = {
    guest_uuid: account,
    visited_workspace: wsUrl,
    visited_workspace_uuid: workspaceLoginInfo.workspace
  }
  Analytics.handleEvent('GUEST LOGIN', data)

  if (me !== undefined) {
    Analytics.setUser(data.guest_uuid, data)
    Analytics.setWorkspace(wsUrl, true)
    console.log('login: employee account', me)
    setCurrentAccount(me)
    setCurrentEmployee('' as Ref<Employee>)
  }

  invalidError.set(false)
  versionError.set(undefined)
  // Update window title
  document.title = [wsUrl, title].filter((it) => it).join(' - ')
  _clientSet = true
  await setClient(_client)
  await setCommunicationClient(_client)

  return _client
}
