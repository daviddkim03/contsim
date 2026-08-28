/**
 * Unit handling at the UI boundary. The core works in integer units; here the
 * user's decimal inputs are scaled to integers and core numbers are scaled
 * back for display (PROJECT.md section 2).
 */

export type Unit = 'in' | 'ft' | 'cm' | 'mm' | 'm'
export const UNITS: readonly Unit[] = ['in', 'ft', 'cm', 'mm', 'm']

/** Decimals kept from user input. Anything finer is rounded. */
export const MAX_DECIMALS = 3

const NUMBER = /^\s*(\d*)(?:\.(\d*))?\s*$/

/** Parses a non-negative decimal typed by the user ("12", "12.5", ".5"). Null for anything else. */
export function parseLength(text: string): number | null {
  const m = NUMBER.exec(text)
  if (!m) return null
  const [, int = '', frac = ''] = m
  if (int === '' && frac === '') return null
  return Number(`${int || '0'}.${frac || '0'}`)
}

/** Parses a non-negative whole number. Null for anything else. */
export function parseCount(text: string): number | null {
  return /^\s*\d+\s*$/.test(text) ? Number(text) : null
}

/** Number of significant decimals in a typed length, capped at MAX_DECIMALS. */
export function decimalsOf(text: string): number {
  const m = NUMBER.exec(text)
  if (!m) return 0
  const frac = (m[2] ?? '').replace(/0+$/, '')
  return Math.min(frac.length, MAX_DECIMALS)
}

/** Scale factor (a power of ten) that turns every given length into an integer. */
export function scaleFor(texts: string[]): number {
  const decimals = Math.max(0, ...texts.map(decimalsOf))
  return 10 ** decimals
}

export const toInt = (value: number, scale: number): number => Math.round(value * scale)
export const fromInt = (int: number, scale: number): number => int / scale

const number = (n: number, maxFraction = MAX_DECIMALS) =>
  n.toLocaleString('en-US', { maximumFractionDigits: maxFraction })

export function formatNumber(int: number, scale: number): string {
  return number(fromInt(int, scale))
}

export function formatLength(int: number, scale: number, unit: Unit): string {
  return `${formatNumber(int, scale)} ${unit}`
}

/** Cubic units are unwieldy in inches or millimetres, so volumes are shown in cubic feet or cubic metres. */
export function formatVolume(int: number, scale: number, unit: Unit): string {
  const cubic = int / scale ** 3
  switch (unit) {
    case 'in':
      return `${number(cubic / 1728, 1)} cu ft`
    case 'ft':
      return `${number(cubic, 1)} cu ft`
    case 'cm':
      return `${number(cubic / 1e6, 2)} m³`
    case 'mm':
      return `${number(cubic / 1e9, 2)} m³`
    case 'm':
      return `${number(cubic, 2)} m³`
  }
}
