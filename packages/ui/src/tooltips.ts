import { type IntlString } from '@hcengineering/platform'
import { derived, get } from 'svelte/store'
import type { AnyComponent, AnySvelteComponent, LabelAndProps, TooltipAlignment } from './types'
import { modalStore } from './modals'

const emptyTooltip: LabelAndProps = {
  label: undefined,
  element: undefined,
  direction: undefined,
  component: undefined,
  props: undefined,
  anchor: undefined,
  onUpdate: undefined,
  keys: undefined,
  kind: 'tooltip',
  style: undefined,
  noArrow: false,
  textAlign: undefined
}
let storedValue: LabelAndProps = emptyTooltip
export const tooltipstore = derived(modalStore, (modals) => {
  if (modals.length === 0) {
    return emptyTooltip
  }
  const tooltip = modals.filter((m) => m?.type === 'tooltip')
  return tooltip.length > 0 ? (tooltip[tooltip.length - 1] as LabelAndProps) : emptyTooltip
})

let toHandler: any
export function tooltip (node: HTMLElement, options?: LabelAndProps): any {
  if (options === undefined || (options.label === undefined && options.component === undefined)) {
    // No tooltip
    // TODO: Fix reactive options update in this case
    return {}
  }
  let opt = options
  const show = (): void => {
    const shown = !!(storedValue.label !== undefined || storedValue.component !== undefined)
    if (!shown) {
      if (opt?.kind !== 'submenu' || opt.timeout !== undefined) {
        clearTimeout(toHandler)
        toHandler = setTimeout(() => {
          showTooltip(
            opt.label,
            node,
            opt.direction,
            opt.component,
            opt.props,
            opt.anchor,
            opt.onUpdate,
            opt.kind,
            opt.keys,
            opt.style,
            opt.noArrow,
            opt.textAlign
          )
        }, opt.timeout ?? 10)
      } else {
        showTooltip(
          opt.label,
          node,
          opt.direction,
          opt.component,
          opt.props,
          opt.anchor,
          opt.onUpdate,
          opt.kind,
          opt.keys,
          opt.style,
          opt.noArrow,
          opt.textAlign
        )
      }
    }
  }
  /**
   * Cierra el tooltip cuando el puntero sale del nodo.
   *
   * Cancela el temporizador pendiente y, además, cierra el tooltip ya visible si pertenece
   * a este nodo y no tiene contenido interactivo. Los tooltips con `component` quedan fuera
   * a propósito: en ellos el cursor viaja del elemento al propio tooltip, y su cierre lo
   * decide `whileShow` en `TooltipInstance.svelte` con el hit-test sobre el popup.
   */
  const hide = (): void => {
    clearTimeout(toHandler)
    const current = get(tooltipstore)
    if (current.element === node && current.component === undefined) {
      closeTooltip()
    }
  }
  node.addEventListener('mouseleave', hide)
  node.addEventListener('mousemove', show)
  return {
    update (options: LabelAndProps) {
      opt = options
      if (node !== storedValue.element) return
      const shown = !!(storedValue.label !== undefined || storedValue.component !== undefined)
      if (shown) {
        showTooltip(
          opt.label,
          node,
          opt.direction,
          opt.component,
          opt.props,
          opt.anchor,
          opt.onUpdate,
          opt.kind,
          opt.keys,
          opt.style,
          opt.noArrow,
          opt.textAlign
        )
      }
    },

    destroy () {
      const currentTooltip = get(tooltipstore)
      if (currentTooltip?.element != null && currentTooltip.element === node) {
        closeTooltip()
      }
      node.removeEventListener('mousemove', show)
      node.removeEventListener('mouseleave', hide)
    }
  }
}

/**
 * Muestra un tooltip y lo deja como único tooltip de `modalStore`.
 *
 * Reemplaza la entrada de tipo `tooltip` que hubiera en lugar de acumular otra, de modo que
 * `tooltipstore` (que pinta la última) y el `findIndex` del z-index apunten siempre a la misma.
 * Si el tooltip anterior era del mismo componente y el nuevo no trae `kind`, se hereda el
 * anterior (así un `kind: 'popup'` sobrevive a las actualizaciones reactivas de la acción).
 *
 * @param label Etiqueta a mostrar, si el tooltip es de texto.
 * @param element Nodo que dispara el tooltip; sirve de ancla y de identidad para cerrarlo.
 * @param direction Lado preferido de aparición.
 * @param component Componente a renderizar dentro del tooltip, si es interactivo.
 * @param props Props del componente.
 * @param anchor Nodo alternativo para calcular la posición.
 * @param onUpdate Callback para el evento `update` del componente.
 * @param kind Tipo de tooltip: `tooltip`, `submenu` o `popup`.
 * @param keys Atajos de teclado a mostrar junto a la etiqueta.
 * @param style Variante visual.
 * @param noArrow Oculta el nub que apunta al elemento.
 * @param textAlign Alineación del texto de la etiqueta.
 */
export function showTooltip (
  label: IntlString | undefined,
  element: HTMLElement,
  direction?: TooltipAlignment,
  component?: AnySvelteComponent | AnyComponent,
  props?: any,
  anchor?: HTMLElement,
  onUpdate?: (result: any) => void,
  kind?: 'tooltip' | 'submenu' | 'popup',
  keys?: string[],
  style?: 'default' | 'modern',
  noArrow?: boolean,
  textAlign?: 'left' | 'center' | 'right'
): void {
  storedValue = {
    label,
    element,
    direction,
    component,
    props,
    anchor,
    onUpdate,
    kind,
    keys,
    type: 'tooltip',
    style,
    noArrow,
    textAlign
  }
  modalStore.update((old) => {
    const tooltip = old.find((m) => m?.type === 'tooltip') as LabelAndProps | undefined
    if (tooltip !== undefined && tooltip.component === storedValue.component) {
      if (tooltip.kind !== undefined && storedValue.kind === undefined) {
        storedValue.kind = tooltip.kind
      }
    }

    if (storedValue.kind == null) {
      storedValue.kind = 'tooltip'
    }

    return [...old.filter((m) => m?.type !== 'tooltip'), storedValue]
  })
}

export function closeTooltip (): void {
  clearTimeout(toHandler)
  storedValue = emptyTooltip
  modalStore.update((old) => {
    old = old.filter((m) => m?.type !== 'tooltip')
    return old
  })
}
