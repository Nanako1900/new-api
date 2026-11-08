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
import { CREAM, INK, ORANGE, YELLOW, isDark, luminance, shade } from './color'
import type { MeowTraits } from './types'

const ROUND = 'stroke-linejoin="round"'
const CAP = 'stroke-linecap="round"'

export function starPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number
): string {
  const points: string[] = []
  for (let i = 0; i < 10; i++) {
    const angle = ((-90 + i * 36) * Math.PI) / 180
    const radius = i % 2 === 0 ? outer : inner
    points.push(
      `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`
    )
  }
  return `M${points.join('L')}Z`
}

function flower(color: string): string {
  let petals = ''
  for (let i = 0; i < 5; i++) {
    const angle = ((i * 72 - 90) * Math.PI) / 180
    petals += `<circle cx="${(34 + 5.4 * Math.cos(angle)).toFixed(2)}" cy="${(30 + 5.4 * Math.sin(angle)).toFixed(2)}" r="4.8"/>`
  }
  const center = color === YELLOW ? ORANGE : YELLOW
  return `<g fill="${color}">${petals}</g><circle cx="34" cy="30" r="3.4" fill="${center}"/>`
}

function pixelShades(color: string): string {
  const rows: Array<[number, number, number]> = [
    [24, 60, 72],
    [33, 63, 24],
    [63, 63, 24],
    [36, 66, 18],
    [66, 66, 18],
    [39, 69, 12],
    [69, 69, 12],
  ]
  const lens = rows
    .map(
      ([x, y, w]) =>
        `<rect x="${x}" y="${y}" width="${w}" height="3" fill="${color}"/>`
    )
    .join('')
  const glints = [
    [36, 63],
    [39, 66],
    [66, 63],
    [69, 66],
  ]
    .map(
      ([x, y]) =>
        `<rect x="${x}" y="${y}" width="3" height="3" fill="${CREAM}"/>`
    )
    .join('')
  return lens + glints
}

function thoughtBubble(color: string): string {
  const dot = luminance(color) > 0.75 ? INK : CREAM
  return `<circle cx="79" cy="31" r="2.2" fill="${color}"/><circle cx="83.5" cy="26.5" r="3" fill="${color}"/><ellipse cx="94" cy="17" rx="14.5" ry="9.5" fill="${color}"/><circle cx="88" cy="17" r="1.9" fill="${dot}"/><circle cx="94" cy="17" r="1.9" fill="${dot}"/><circle cx="100" cy="17" r="1.9" fill="${dot}"/>`
}

/** Pieces drawn behind the head, such as the headphone band. */
export function drawAccessoryBehind(traits: MeowTraits): string {
  if (traits.accessory.id !== 'phones') return ''
  return `<path d="M16 56C11 10 109 10 104 56" fill="none" stroke="${traits.accessoryColor}" stroke-width="6" ${CAP}/>`
}

export function drawAccessory(traits: MeowTraits): string {
  const c = traits.accessoryColor
  switch (traits.accessory.id) {
    case 'bow':
      return `<g fill="${c}" stroke="${c}" stroke-width="2" ${ROUND}><path d="M86 31L73 23Q70.5 31 73.5 40Z"/><path d="M86 31L99 23Q101.5 31 98.5 40Z"/></g><circle cx="86" cy="31" r="4" fill="${shade(c)}"/>`
    case 'flower':
      return flower(c)
    case 'glasses':
      return `<g fill="none" stroke="${c}" stroke-width="3.2"><circle cx="45" cy="70" r="11"/><circle cx="75" cy="70" r="11"/><path d="M56 68.5Q60 65.5 64 68.5"/></g>`
    case 'leaf':
      return `<path d="M60 28Q56 14 68 8Q73 21 60 28Z" fill="#6FA35F"/><path d="M60.5 27Q63.5 18 67.5 10.5" stroke="#4E8040" stroke-width="1.6" fill="none" ${CAP}/>`
    case 'star':
      return `<path d="${starPath(36, 33, 7.5, 3.3)}" fill="${YELLOW}" stroke="${YELLOW}" stroke-width="1.5" ${ROUND}/>`
    case 'party':
      return `<path d="M50 30L60 3L70 30Z" fill="${c}" stroke="${c}" stroke-width="2" ${ROUND}/><path d="M53.7 20H66.3" stroke="${CREAM}" stroke-width="2.6"/><circle cx="60" cy="3.5" r="4" fill="${CREAM}"/>`
    case 'crown':
      return `<path d="M44 31L42 12L52 20L60 8L68 20L78 12L76 31Z" fill="${YELLOW}" stroke="${YELLOW}" stroke-width="2" ${ROUND}/><circle cx="60" cy="24" r="2.8" fill="#D9483B"/>`
    case 'phones':
      return `<rect x="7" y="43" width="16" height="24" rx="7.5" fill="${c}"/><rect x="97" y="43" width="16" height="24" rx="7.5" fill="${c}"/><rect x="18" y="47" width="6.5" height="16" rx="3.2" fill="${shade(c)}"/><rect x="95.5" y="47" width="6.5" height="16" rx="3.2" fill="${shade(c)}"/>`
    case 'code':
      return `<rect x="21" y="24" width="28" height="15" rx="7.5" fill="${c}"/><path d="M30.5 27.8L26.8 31.5L30.5 35.2M37 27.2L34 35.8M39.5 27.8L43.2 31.5L39.5 35.2" fill="none" stroke="${CREAM}" stroke-width="2" ${CAP} ${ROUND}/>`
    case 'tie':
      return `<g fill="${c}" stroke="${c}" stroke-width="2" ${ROUND}><path d="M60 104L48 97.5Q46 104 48 110.5Z"/><path d="M60 104L72 97.5Q74 104 72 110.5Z"/></g><rect x="56.5" y="100.5" width="7" height="7" rx="2.5" fill="${shade(c)}"/>`
    case 'shades':
      return `<rect x="32.5" y="62" width="25" height="16" rx="7.5" fill="${c}"/><rect x="62.5" y="62" width="25" height="16" rx="7.5" fill="${c}"/><path d="M57 66.5Q60 64.5 63 66.5" fill="none" stroke="${c}" stroke-width="3"/><path d="M37 66.5L42 66.5M67 66.5L72 66.5" stroke="${CREAM}" stroke-opacity=".7" stroke-width="2.2" ${CAP}/>`
    case 'beanie':
      return `<path d="M29 47C29 27 43 18 60 18C77 18 91 27 91 47Z" fill="${c}"/><rect x="27" y="40" width="66" height="11" rx="5.5" fill="${shade(c)}"/><circle cx="60" cy="16" r="6" fill="${CREAM}"/>`
    case 'collar':
      return `<path d="M27 99Q60 115 93 99" fill="none" stroke="${c}" stroke-width="7" ${CAP}/><circle cx="60" cy="108" r="5" fill="${YELLOW}"/><path d="M57.5 109H62.5" stroke="${INK}" stroke-width="1.4" ${CAP}/>`
    case 'aid':
      return `<g transform="rotate(-24 86 80)"><rect x="75" y="75.5" width="22" height="9" rx="4.5" fill="#F2C48D"/><rect x="82.5" y="75.5" width="7" height="9" fill="#E3AD72"/></g>`
    case 'ahoge': {
      const fur = traits.pattern?.top ?? traits.coat.top ?? traits.coat.base
      return `<path d="M60 28C57 19 62 12 68 13C73 14 72 21 66 21" fill="none" stroke="${fur}" stroke-width="3.6" ${CAP}/>`
    }
    case 'heart':
      return `<path d="M34 39C25 33 26 25 30.5 25C32.5 25 34 26.5 34 28.5C34 26.5 35.5 25 37.5 25C42 25 43 33 34 39Z" fill="${c}" stroke="${c}" stroke-width="1.5" ${ROUND}/>`
    case 'halo':
      return '<ellipse cx="60" cy="13" rx="18" ry="5" fill="none" stroke="#F2C94C" stroke-width="3.6"/>'
    case 'horns':
      return '<path d="M43 31C40 23 42 16 47 11C47 18 49 24 52 29Z" fill="#C94A3D"/><path d="M77 31C80 23 78 16 73 11C73 18 71 24 68 29Z" fill="#C94A3D"/>'
    case 'fish':
      return `<g transform="translate(65 93) rotate(-8)"><ellipse cx="0" cy="0" rx="9.5" ry="4.2" fill="#A9B7C6"/><path d="M8 0L15.5 -5.5L15.5 5.5Z" fill="#A9B7C6" stroke="#A9B7C6" stroke-width="1.5" ${ROUND}/><circle cx="-5" cy="-1" r="1.2" fill="${INK}"/></g>`
    case 'pixel':
      return pixelShades(traits.under.some(isDark) ? c : INK)
    case 'banana':
      return `<path fill-rule="evenodd" d="M8 90C2 50 24 10 60 8C96 10 118 50 112 90C108 104 96 112 84 114L36 114C24 112 12 104 8 90ZM25 76A35 28 0 1 0 95 76A35 28 0 1 0 25 76Z" fill="#F5D547"/><path d="M60 9C50 24 46 40 46 50M60 9C70 24 74 40 74 50" fill="none" stroke="#E3B92E" stroke-width="2.4" ${CAP}/><rect x="56" y="1" width="8" height="10" rx="3" fill="#7A5A2E"/>`
    case 'duck':
      return `<ellipse cx="63" cy="23" rx="10.5" ry="6.5" fill="#F5D547"/><circle cx="56" cy="14" r="6.2" fill="#F5D547"/><path d="M50.5 13L45.5 15L50.5 17Z" fill="${ORANGE}" stroke="${ORANGE}" stroke-width="1.6" ${ROUND}/><circle cx="55" cy="12.5" r="1.3" fill="${INK}"/>`
    case 'think':
      return thoughtBubble(c)
    case 'huh':
      return `<path d="M93 12C93 6 103 6 103 12C103 16 98 17 98 21" fill="none" stroke="${c}" stroke-width="3.8" ${CAP} ${ROUND}/><circle cx="98" cy="27.5" r="2.4" fill="${c}"/>`
    case 'sweat':
      return '<path d="M92 36C88 42 86 46 86 49C86 53 89 55.5 92 55.5C95 55.5 98 53 98 49C98 46 96 42 92 36Z" fill="#86C5EC"/>'
    case 'glasses-3d':
      return '<rect x="30.5" y="61" width="59" height="18" rx="4" fill="#FFFDF6"/><rect x="34" y="63.5" width="21" height="13" rx="2.5" fill="#E5484D" fill-opacity=".9"/><rect x="65" y="63.5" width="21" height="13" rx="2.5" fill="#3FC1D9" fill-opacity=".9"/>'
    default:
      return ''
  }
}
