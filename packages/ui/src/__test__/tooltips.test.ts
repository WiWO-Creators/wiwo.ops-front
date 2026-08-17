//
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
//
import { type IntlString } from '@hcengineering/platform'
import { get } from 'svelte/store'
import { modalStore } from '../modals'
import { closeTooltip, showTooltip, tooltip, tooltipstore } from '../tooltips'
import type { AnySvelteComponent } from '../types'

const label = 'test.Label' as IntlString
const interactive = {} as unknown as AnySvelteComponent

describe('tooltip', () => {
  afterEach(() => {
    closeTooltip()
  })

  it('should close a label tooltip when the pointer leaves its own node', () => {
    const node = document.createElement('div')
    tooltip(node, { label })
    showTooltip(label, node)
    expect(get(tooltipstore).element).toBe(node)

    node.dispatchEvent(new MouseEvent('mouseleave'))

    expect(get(tooltipstore).label).toBeUndefined()
    expect(get(tooltipstore).element).toBeUndefined()
  })

  it('should keep an interactive tooltip open when the pointer leaves its node', () => {
    const node = document.createElement('div')
    tooltip(node, { component: interactive })
    showTooltip(undefined, node, undefined, interactive)

    node.dispatchEvent(new MouseEvent('mouseleave'))

    expect(get(tooltipstore).component).toBe(interactive)
    expect(get(tooltipstore).element).toBe(node)
  })

  it('should not close a tooltip belonging to another node', () => {
    const hovered = document.createElement('div')
    const other = document.createElement('div')
    tooltip(other, { label })
    showTooltip(label, hovered)

    other.dispatchEvent(new MouseEvent('mouseleave'))

    expect(get(tooltipstore).element).toBe(hovered)
  })

  it('should keep a single tooltip in the modal store instead of stacking them', () => {
    const first = document.createElement('div')
    const second = document.createElement('div')
    showTooltip(label, first)
    showTooltip(label, second)

    const tooltips = get(modalStore).filter((m) => m?.type === 'tooltip')
    expect(tooltips).toHaveLength(1)
    expect(get(tooltipstore).element).toBe(second)
  })
})
