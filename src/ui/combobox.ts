/**
 * A searchable dropdown attached to a text input: type to filter, arrow keys
 * to move, Enter or click to choose, Escape to dismiss. One shared listbox
 * lives on the body (fixed position) so it can overflow the scrolling
 * sidebar, and only one combobox is open at a time.
 */

import { h } from './dom'

export interface ComboboxOption {
  id: string
  label: string
  detail?: string
  /** Small marker after the label, e.g. "yours" for a saved catalog item. */
  tag?: string
  /** Rendered apart from the matches, e.g. "Custom size...". */
  action?: boolean
}

export interface ComboboxResults {
  options: ComboboxOption[]
  /** Matches that were cut off; shown as "+ n more". */
  more?: number
  /** Option highlighted first; -1 for none. Defaults to the first option. */
  active?: number
}

export interface ComboboxHandlers {
  search(query: string): ComboboxResults
  /** A choice was made; the query is what the user had typed. */
  onSelect(option: ComboboxOption, query: string): void
  /** The dropdown closed without a choice; the query is the input's text at that moment. */
  onDismiss?(query: string): void
}

export interface Combobox {
  close(): void
}

const LIST_ID = 'combobox-list'
const MIN_WIDTH = 260
const MAX_HEIGHT = 320

interface Open {
  input: HTMLInputElement
  close(): void
  choose(index: number): void
}

let list: HTMLUListElement | null = null
let openFor: Open | null = null

function sharedList(): HTMLUListElement {
  if (!list) {
    list = h('ul', { id: LIST_ID, class: 'combobox-list', role: 'listbox', hidden: '' })
    document.body.append(list)
    window.addEventListener('resize', () => openFor?.close())
    // Any scroll (the sidebar's box list included) moves the input, so follow it.
    document.addEventListener('scroll', () => position(), true)
    // mousedown fires before the input's blur, so the click still belongs to the open combobox.
    list.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const option = (event.target as HTMLElement).closest<HTMLElement>('.combobox-option')
      if (option && openFor) openFor.choose(Number(option.dataset.index))
    })
  }
  return list
}

function position(): void {
  if (!openFor || !list) return
  const rect = openFor.input.getBoundingClientRect()
  const width = Math.max(rect.width, MIN_WIDTH)
  const left = Math.min(rect.left, window.innerWidth - width - 8)
  const below = window.innerHeight - rect.bottom
  const height = Math.min(MAX_HEIGHT, list.scrollHeight)
  const placeAbove = below < height + 8 && rect.top > below
  list.style.left = `${Math.max(8, left)}px`
  list.style.width = `${width}px`
  list.style.maxHeight = `${MAX_HEIGHT}px`
  if (placeAbove) {
    list.style.top = `${Math.max(8, rect.top - 4 - height)}px`
  } else {
    list.style.top = `${rect.bottom + 4}px`
  }
}

export function attachCombobox(input: HTMLInputElement, handlers: ComboboxHandlers): Combobox {
  let options: ComboboxOption[] = []
  let active = -1
  let isOpen = false

  input.setAttribute('role', 'combobox')
  input.setAttribute('aria-autocomplete', 'list')
  input.setAttribute('aria-expanded', 'false')
  input.setAttribute('aria-controls', LIST_ID)

  function render(): void {
    const ul = sharedList()
    const { options: found, more = 0, active: first = 0 } = handlers.search(input.value)
    options = found
    active = options.length > 0 ? Math.min(first, options.length - 1) : -1
    ul.replaceChildren(
      ...options.map((option, i) =>
        h(
          'li',
          {
            id: `${LIST_ID}-${i}`,
            class: `combobox-option${option.action ? ' action' : ''}`,
            role: 'option',
            'data-index': String(i),
          },
          [
            h('span', { class: 'option-label', text: option.label }),
            ...(option.tag ? [h('span', { class: 'option-tag', text: option.tag })] : []),
            ...(option.detail ? [h('span', { class: 'option-detail', text: option.detail })] : []),
          ],
        ),
      ),
      ...(more > 0
        ? [h('li', { class: 'combobox-more', text: `+ ${more} more, keep typing to narrow down` })]
        : []),
      ...(options.length === 0 && more === 0
        ? [h('li', { class: 'combobox-more', text: 'No matches' })]
        : []),
    )
    highlight()
    position()
  }

  function highlight(): void {
    const ul = sharedList()
    ul.querySelectorAll<HTMLElement>('.combobox-option').forEach((el, i) => {
      el.classList.toggle('active', i === active)
      el.setAttribute('aria-selected', i === active ? 'true' : 'false')
    })
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${LIST_ID}-${active}`)
      ul.children[active]?.scrollIntoView({ block: 'nearest' })
    } else {
      input.removeAttribute('aria-activedescendant')
    }
  }

  function open(): void {
    if (isOpen) return
    openFor?.close()
    isOpen = true
    openFor = { input, close, choose }
    const ul = sharedList()
    ul.hidden = false
    input.setAttribute('aria-expanded', 'true')
    render()
  }

  function close(dismiss = true): void {
    if (!isOpen) return
    isOpen = false
    if (openFor?.input === input) openFor = null
    sharedList().hidden = true
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
    if (dismiss) handlers.onDismiss?.(input.value)
  }

  function choose(index: number): void {
    const option = options[index]
    if (!option) return
    const query = input.value
    close(false)
    handlers.onSelect(option, query)
  }

  input.addEventListener('focus', () => {
    input.select()
    open()
  })
  input.addEventListener('input', () => {
    open()
    render()
  })
  input.addEventListener('blur', () => close())
  input.addEventListener('keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!isOpen) open()
        else if (options.length > 0) {
          active = (active + 1) % options.length
          highlight()
        }
        break
      case 'ArrowUp':
        event.preventDefault()
        if (options.length > 0) {
          active = (active - 1 + options.length) % options.length
          highlight()
        }
        break
      case 'Enter':
        if (isOpen) {
          event.preventDefault()
          if (active >= 0) choose(active)
          else close()
        }
        break
      case 'Escape':
        if (isOpen) {
          event.preventDefault()
          close()
          input.blur()
        }
        break
    }
  })

  return { close }
}
