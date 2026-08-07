//
// Copyright © 2020 Anticrm Platform Contributors.
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

import { Analytics } from '@hcengineering/analytics'
import '@hcengineering/platform-rig/profiles/ui/svelte'
import { derived, writable } from 'svelte/store'
import { ThemeVariant, type ThemeVariantType } from './variants'

export { default as Theme } from './Theme.svelte'
export { default as InvertedTheme } from './InvertedTheme.svelte'
export { ThemeVariant, type ThemeVariantType } from './variants'

const LANG_MIGRATION_KEY = 'langMigratedEs'

/**
 * Establece el idioma inicial de la interfaz.
 *
 * Si el usuario todavía no tiene idioma guardado, se le asigna el de la marca.
 * Si ya lo tiene en inglés y nunca pasó por esta migración, se le aplica una
 * única vez el idioma de la marca; a partir de ahí su elección manual manda.
 *
 * @param language idioma por defecto de la marca (código ISO, p. ej. 'es')
 * @public
 */
export const setDefaultLanguage = (language: string): void => {
  const current = localStorage.getItem('lang')
  const alreadyMigrated = localStorage.getItem(LANG_MIGRATION_KEY) !== null
  if (current === null || (!alreadyMigrated && current === 'en')) {
    localStorage.setItem('lang', language)
  }
  if (!alreadyMigrated) {
    localStorage.setItem(LANG_MIGRATION_KEY, '1')
  }
}

function getDefaultProps (prop: string, value: string): string {
  localStorage.setItem(prop, value)
  return value
}

/**
 * @public
 */
export const isSystemThemeDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches
/**
 * @public
 */
export const isThemeDark = (theme: string): boolean =>
  theme === 'theme-dark' || (theme === 'theme-system' && isSystemThemeDark())
/**
 * @public
 */
export const getCurrentTheme = (): string => localStorage.getItem('theme') ?? getDefaultProps('theme', 'theme-system')
/**
 * @public
 */
export const getCurrentFontSize = (): string =>
  localStorage.getItem('fontsize') ?? getDefaultProps('fontsize', 'normal-font')
/**
 * @public
 */
export const getCurrentLanguage = (): string => {
  const lang = localStorage.getItem('lang') ?? getDefaultProps('lang', 'es')
  Analytics.setTag('language', lang)
  return lang
}
/**
 * @public
 */
export const getCurrentEmoji = (): string => localStorage.getItem('emoji') ?? getDefaultProps('emoji', 'emoji-system')

export class ThemeOptions {
  readonly variant: ThemeVariantType
  constructor (
    readonly fontSize: number,
    readonly dark: boolean,
    readonly language: string,
    readonly emoji: string
  ) {
    this.variant = dark ? ThemeVariant.Dark : ThemeVariant.Light
  }
}
export const themeStore = writable<ThemeOptions>()

export function initThemeStore (): void {
  themeStore.set(
    new ThemeOptions(
      getCurrentFontSize() === 'normal-font' ? 16 : 14,
      isThemeDark(getCurrentTheme()),
      getCurrentLanguage(),
      getCurrentEmoji()
    )
  )
}

export const languageStore = derived(themeStore, ($theme) => $theme?.language ?? '')
