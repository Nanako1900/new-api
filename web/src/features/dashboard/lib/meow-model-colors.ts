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
/**
 * Chart colours for models. Every model gets its own colour so neighbouring
 * bars stay easy to tell apart, and the hues are grouped by vendor:
 * Claude warm (orange, brick, gold), GPT ink and cool (ink, teal, blue),
 * other vendors earthy (olive, plum, sand). A model keeps its colour
 * wherever it shows up.
 */
import { modelVendor, OTHER_SERIES, type ModelVendor } from './meow-usage'

export type ChartSeries = { id: string; label: string; className: string }

type Shade = { light: string; dark: string }

/** Hues per vendor; the first three are the tier picks. */
export const MODEL_SHADES: Record<ModelVendor, Shade[]> = {
  claude: [
    { light: '#B4432F', dark: '#D46A54' }, // opus: brick
    { light: '#EE8A3C', dark: '#F0954F' }, // sonnet: brand orange
    { light: '#D9A43A', dark: '#E2B456' }, // haiku: gold
    { light: '#C46A7C', dark: '#D68A99' }, // rose
    { light: '#8F3A1C', dark: '#B85A35' }, // rust
    { light: '#E7B07A', dark: '#EDC092' }, // apricot
  ],
  gpt: [
    { light: '#1E1B17', dark: '#EDE6DC' }, // flagship: ink
    { light: '#2E8A80', dark: '#4FB3A7' }, // teal
    { light: '#4C6EA6', dark: '#7D9BD0' }, // mini / nano: blue
    { light: '#6F5B9E', dark: '#9C89C9' }, // violet
    { light: '#5F7A8A', dark: '#8FA7B5' }, // steel
    { light: '#1F5F59', dark: '#3E8F86' }, // deep teal
  ],
  other: [
    { light: '#7C9A40', dark: '#9DBA5E' }, // olive
    { light: '#8E4F86', dark: '#B87AAE' }, // plum
    { light: '#A88D6A', dark: '#C4AA86' }, // sand
    { light: '#4F6B34', dark: '#7E9C5E' }, // moss
    { light: '#A86A8E', dark: '#C893B0' }, // mauve
    { light: '#8F8146', dark: '#B3A566' }, // khaki
  ],
}

/** Colour of the folded "Other" series. */
export const OTHER_SHADE: Shade = { light: '#CFC6B8', dark: '#5A544C' }

/**
 * Once a vendor's six hues are taken, later models get the same hues
 * lighter, then deeper, then lighter still.
 */
const SHADE_ROUNDS = [
  { toward: 255, amount: 0 },
  { toward: 255, amount: 0.35 },
  { toward: 0, amount: 0.3 },
  { toward: 255, amount: 0.6 },
]

/** Provider-level series, top of the stack first. */
export const PROVIDER_SERIES: ChartSeries[] = [
  { id: OTHER_SERIES, label: 'Other', className: 'bg-input dark:bg-white/25' },
  { id: 'gpt', label: 'GPT', className: 'bg-[#1E1B17] dark:bg-[#EDE6DC]' },
  {
    id: 'claude',
    label: 'Claude',
    className: 'bg-[#EE8A3C] dark:bg-[#F0954F]',
  },
]

function mixChannels(hex: string, toward: number, amount: number): string {
  const value = Number.parseInt(hex.slice(1), 16)
  const channels = [16, 8, 0].map((shift) => (value >> shift) & 255)
  const mixed = channels.map((channel) =>
    Math.round(channel + (toward - channel) * amount)
      .toString(16)
      .padStart(2, '0')
  )
  return `#${mixed.join('').toUpperCase()}`
}

/** The colour at `index` of a vendor's palette, past six included. */
function shadeAt(vendor: ModelVendor, index: number): Shade {
  const hues = MODEL_SHADES[vendor]
  const base = hues[index % hues.length]
  const round =
    SHADE_ROUNDS[Math.floor(index / hues.length) % SHADE_ROUNDS.length]
  if (round.amount === 0) return base
  return {
    light: mixChannels(base.light, round.toward, round.amount),
    dark: mixChannels(base.dark, round.toward, round.amount),
  }
}

/** Preferred palette index for the tier a model name suggests. */
function tierIndex(model: string, vendor: ModelVendor): number {
  const name = model.toLowerCase()
  if (vendor === 'claude') {
    if (name.includes('opus')) return 0
    if (name.includes('haiku')) return 2
    if (name.includes('sonnet')) return 1
    return 3
  }
  if (/mini|nano|lite/.test(name)) return 2
  return 0
}

/**
 * Vendor and palette index per model: each model takes its tier colour,
 * or the first free colour of its vendor when that one is taken.
 */
function assignShades(
  models: string[]
): Map<string, { vendor: ModelVendor; index: number }> {
  const byVendor: Record<ModelVendor, string[]> = {
    claude: [],
    gpt: [],
    other: [],
  }
  for (const model of new Set(models)) byVendor[modelVendor(model)].push(model)

  const assigned = new Map<string, { vendor: ModelVendor; index: number }>()
  for (const vendor of Object.keys(byVendor) as ModelVendor[]) {
    const used = new Set<number>()
    const ordered = [...byVendor[vendor]].sort(
      (a, b) =>
        tierIndex(a, vendor) - tierIndex(b, vendor) || a.localeCompare(b)
    )
    for (const model of ordered) {
      let index = tierIndex(model, vendor)
      if (used.has(index)) {
        index = 0
        while (used.has(index)) index++
      }
      used.add(index)
      assigned.set(model, { vendor, index })
    }
  }
  return assigned
}

/**
 * Hex colours for a chart colour domain (model names plus an "Other"
 * label), in domain order, for charts that need literal colours.
 */
export function modelColorHex(
  domain: string[],
  otherLabel: string,
  isDark: boolean
): string[] {
  const assigned = assignShades(domain.filter((model) => model !== otherLabel))
  return domain.map((model) => {
    const slot = assigned.get(model)
    const shade = slot ? shadeAt(slot.vendor, slot.index) : OTHER_SHADE
    return isDark ? shade.dark : shade.light
  })
}

/** Whether the page is in dark mode right now (the `dark` class on html). */
export function isDarkDocument(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  )
}

/**
 * Dashboard chart colours for a model domain, in the given theme or, when
 * none is given, the current one.
 */
export function meowModelColorRange(
  domain: string[],
  otherLabel: string,
  isDark: boolean = isDarkDocument()
): string[] {
  return modelColorHex(domain, otherLabel, isDark)
}

/** Model name to hex colour, for charts keyed by model name. */
export function modelColorMap(
  models: string[],
  isDark: boolean
): Record<string, string> {
  const colors = modelColorHex(models, '', isDark)
  return Object.fromEntries(
    models.map((model, index) => [model, colors[index]])
  )
}

/**
 * Vendor colours for vendor-level charts: Anthropic the brand orange,
 * OpenAI ink, other vendors the earthy hues in order, "Others" the folded
 * grey. Takes the upstream colour map so every vendor in it gets a colour.
 */
export function vendorColorMap(
  upstream: Record<string, string>,
  isDark: boolean
): Record<string, string> {
  const pick = (shade: Shade) => (isDark ? shade.dark : shade.light)
  let next = 0
  return Object.fromEntries(
    Object.keys(upstream).map((vendor) => {
      const name = vendor.toLowerCase()
      if (name.includes('anthropic') || name.includes('claude')) {
        return [vendor, pick(MODEL_SHADES.claude[1])]
      }
      if (name.includes('openai') || name.includes('gpt')) {
        return [vendor, pick(MODEL_SHADES.gpt[0])]
      }
      if (name === 'others' || name === 'other') {
        return [vendor, pick(OTHER_SHADE)]
      }
      const shade = shadeAt(OTHER_SERIES, next)
      next += 1
      return [vendor, pick(shade)]
    })
  )
}
