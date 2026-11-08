/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

export const INK = '#1E1B17'
export const WHITE = '#FFFFFF'
export const CREAM = '#FFF4E6'
export const ORANGE = '#EE8A3C'
export const DEEP_ORANGE = '#D9701F'
export const YELLOW = '#E8B53A'

/** Two colours closer than this (RGB distance) are treated as clashing. */
export const MIN_CONTRAST = 90

function toRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = toRgb(a)
  const [br, bg, bb] = toRgb(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

export function isDark(hex: string): boolean {
  return luminance(hex) < 0.35
}

/** A slightly darker tone, or a lighter one for near-black colours. */
export function shade(hex: string): string {
  const lighten = luminance(hex) < 0.2
  return `#${toRgb(hex)
    .map((channel) =>
      Math.round(lighten ? channel + (255 - channel) * 0.2 : channel * 0.86)
    )
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`
}

/** Keeps a feature colour visible on the fur below it. */
export function legibleOn(color: string, fur: string): string {
  if (colorDistance(color, fur) >= MIN_CONTRAST) return color
  return isDark(fur) ? WHITE : INK
}
