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
import { drawAccessory, drawAccessoryBehind, starPath } from './accessory-art'
import { legibleOn } from './color'
import type { MeowTraits } from './types'

// Lower half of the head silhouette; the ear option draws the upper half.
const HEAD_BOTTOM = 'Q106 64 104 78Q100 106 60 107Q20 106 16 78Q14 64 22 54Z'
// The logo's nose.
const NOSE =
  'M56.6 81.2Q60 80 63.4 81.2Q64.8 82 63.8 83.4L61.2 86.2Q60 87.4 58.8 86.2L56.2 83.4Q55.2 82 56.6 81.2Z'
const CHEEKS =
  '<ellipse cx="32" cy="84" rx="6" ry="3.8" fill="#F2956F" fill-opacity=".38"/><ellipse cx="88" cy="84" rx="6" ry="3.8" fill="#F2956F" fill-opacity=".38"/>'
const EYE_Y = 70

function heartPath(x: number, y: number): string {
  return `M${x} ${y + 6.5}C${x - 2} ${y + 5} ${x - 8} ${y + 1} ${x - 8} ${y - 3}C${x - 8} ${y - 6.5} ${x - 4.5} ${y - 8} ${x - 2.5} ${y - 6.5}C${x - 1.3} ${y - 5.6} ${x} ${y - 4} ${x} ${y - 3.5}C${x} ${y - 4} ${x + 1.3} ${y - 5.6} ${x + 2.5} ${y - 6.5}C${x + 4.5} ${y - 8} ${x + 8} ${y - 6.5} ${x + 8} ${y - 3}C${x + 8} ${y + 1} ${x + 2} ${y + 5} ${x} ${y + 6.5}Z`
}

function drawEye(style: string, x: number, color: string, fur: string): string {
  const y = EYE_Y
  switch (style) {
    case 'big':
      return `<ellipse cx="${x}" cy="${y}" rx="5.7" ry="7.3" fill="${color}"/>`
    case 'round':
      return `<circle cx="${x}" cy="${y}" r="5.6" fill="${color}"/>`
    case 'small':
      return `<ellipse cx="${x}" cy="${y + 1}" rx="3.6" ry="4.6" fill="${color}"/>`
    case 'tear':
      return `<ellipse cx="${x}" cy="${y - 1}" rx="5.4" ry="6.8" fill="${color}"/><path d="M${x} ${y + 7}C${x - 3} ${y + 11} ${x - 3.6} ${y + 13} ${x - 3.6} ${y + 15}C${x - 3.6} ${y + 17.8} ${x + 3.6} ${y + 17.8} ${x + 3.6} ${y + 15}C${x + 3.6} ${y + 13} ${x + 3} ${y + 11} ${x} ${y + 7}Z" fill="#86C5EC"/>`
    case 'heart':
      return `<path d="${heartPath(x, y)}" fill="${legibleOn('#E5566E', fur)}"/>`
    case 'star': {
      const star = legibleOn('#F2B33D', fur)
      return `<path d="${starPath(x, y, 7.6, 3.4)}" fill="${star}" stroke="${star}" stroke-width="1.4" stroke-linejoin="round"/>`
    }
    case 'happy':
      return `<path d="M${x - 6} ${y + 2.5}Q${x} ${y - 6} ${x + 6} ${y + 2.5}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"/>`
    case 'sleepy':
      return `<path d="M${x - 6} ${y - 1}Q${x} ${y + 5} ${x + 6} ${y - 1}" fill="none" stroke="${color}" stroke-width="3.6" stroke-linecap="round"/>`
    default:
      return `<ellipse cx="${x}" cy="${y}" rx="4.8" ry="6.3" fill="${color}"/>`
  }
}

function drawEyes(traits: MeowTraits): string {
  const wink = traits.eye.id === 'wink'
  const left = wink ? 'oval' : traits.eye.id
  const right = wink ? 'happy' : traits.eye.id
  return (
    drawEye(left, 45, traits.eyeColors[0], traits.under[0]) +
    drawEye(right, 75, traits.eyeColors[1], traits.under[1])
  )
}

function drawMouth(style: string, color: string): string {
  const line = `fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"`
  const catMouth = `<path d="M52 89.5Q56 93.5 60 88.8Q64 93.5 68 89.5" ${line}/>`
  switch (style) {
    case 'w':
      return catMouth
    case 'smile':
      return `<path d="M60 87.5V89.5M53.5 89.5Q60 95.5 66.5 89.5" ${line}/>`
    case 'blep':
      return `<path d="M56.6 90.6Q60 99 63.4 90.6Z" fill="#F08C8C"/>${catMouth}`
    case 'open':
      return '<path d="M55 90Q60 88.8 65 90Q64.5 97 60 97Q55.5 97 55 90Z" fill="#8A3A35"/>'
    default:
      return ''
  }
}

/** Builds a standalone SVG document; ids are safe because each avatar is its own image. */
export function renderMeowAvatar(traits: MeowTraits): string {
  const head = traits.ear.path + HEAD_BOTTOM
  const layer = traits.pattern?.layer ?? traits.coat.layer ?? ''
  const mouth =
    traits.accessory.id === 'fish'
      ? ''
      : drawMouth(traits.mouth.id, traits.coat.mouth)
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">',
    `<defs><clipPath id="head"><path d="${head}"/></clipPath></defs>`,
    `<rect width="120" height="120" fill="${traits.background}"/>`,
    '<g transform="translate(60 67) scale(0.92) translate(-60 -60)">',
    drawAccessoryBehind(traits),
    `<path d="${head}" fill="${traits.coat.base}"/>`,
    `<g clip-path="url(#head)">${layer}</g>`,
    traits.coat.front ?? '',
    traits.cheeks ? CHEEKS : '',
    drawEyes(traits),
    `<path d="${NOSE}" fill="${traits.coat.nose}"/>`,
    mouth,
    drawAccessory(traits),
    '</g></svg>',
  ].join('')
}
