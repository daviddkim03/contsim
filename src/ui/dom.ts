/** Small DOM helpers shared by the panels. */

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') el.className = value
    else if (key === 'text') el.textContent = value
    else el.setAttribute(key, value)
  }
  el.append(...children)
  return el
}

export function setText(el: Element, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

/** Updates an input's value only when it differs, so the caret of a focused input is left alone. */
export function setValue(input: HTMLInputElement | HTMLSelectElement, value: string): void {
  if (input.value !== value) input.value = value
}

export function setInvalid(input: HTMLElement, message: string | undefined): void {
  input.classList.toggle('invalid', Boolean(message))
  if (message) {
    input.setAttribute('title', message)
    input.setAttribute('aria-invalid', 'true')
  } else {
    input.removeAttribute('title')
    input.removeAttribute('aria-invalid')
  }
}

/** Offers a file to the user through a temporary object URL. */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  h('a', { href: url, download: filename }).click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function query<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`Missing element: ${selector}`)
  return el
}
