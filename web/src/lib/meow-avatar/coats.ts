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
import { DEEP_ORANGE, INK, ORANGE, WHITE } from './color'
import type { CoatOption, CoatPattern } from './types'

// Shapes use a 120×120 head space; patches are clipped to the head outline.
const SIAMESE_POINT = '#5E4637'
const ALIEN_GREEN = '#8FCB6A'
const ALIEN_STEM = '#4F8A3C'
const ALIEN_TIP = '#D6F58C'

function stripes(color: string, withCheeks: boolean): string {
  const cheeks = withCheeks
    ? 'M13 72L26 74.5M14 81L25 81.5M107 72L94 74.5M106 81L95 81.5'
    : ''
  return `<path d="M52 31L53.5 41M60 29L60 42M68 31L66.5 41${cheeks}" stroke="${color}" stroke-width="4.6" stroke-linecap="round" fill="none"/>`
}

function muzzle(color: string): string {
  return `<path d="M60 71C49 71 40 79 40 89C40 101 52 105 60 105C68 105 80 101 80 89C80 79 71 71 60 71Z" fill="${color}"/>`
}

// The logo's own patches: orange over the left ear, black around the right eye.
const LOGO_PATCHES = `<path d="M0 0H62C61 14 63 26 58 36C54 44 50 52 42 55C34 58 28 58 22 62C18 65 14 70 8 74L0 76Z" fill="${ORANGE}"/><path d="M70 56C76 50 86 50 94 54C95.3 54.7 96.4 55.4 97.6 56Q101.3 57.3 99.2 53.8L112 52L112 80L103.8 78.1Q104.3 74.2 101.2 75.6C99.6 76.3 97.8 77.8 96 80C90 86 80 88 72 84C64 80 62 64 70 56Z" fill="${INK}"/>`

// Every calico patch touches the head outline; a floating spot reads as a mole.
const CALICO_PATTERNS: readonly CoatPattern[] = [
  {
    id: 'logo',
    weight: 1,
    layer: LOGO_PATCHES,
    under: [WHITE, INK],
    top: ORANGE,
  },
  {
    id: 'mirror',
    weight: 1,
    layer: `<g transform="matrix(-1 0 0 1 120 0)">${LOGO_PATCHES}</g>`,
    under: [INK, WHITE],
    top: ORANGE,
  },
  {
    id: 'ears',
    weight: 1,
    layer: `<path d="M120 0H58C59 12 57 24 62 32C66 40 72 46 80 48C88 50 96 48 104 52C110 55 116 58 120 60Z" fill="${ORANGE}"/><path d="M0 0H46C48 14 44 28 36 38C28 46 16 50 0 52Z" fill="${INK}"/>`,
    under: [WHITE, WHITE],
    top: ORANGE,
  },
  {
    id: 'side',
    weight: 1,
    layer: `<path d="M0 0H52C52 18 46 34 34 44C26 50 12 54 0 56Z" fill="${INK}"/><path d="M120 30C102 32 90 46 88 62C86 78 94 92 108 100L120 104Z" fill="${ORANGE}"/>`,
    under: [WHITE, WHITE],
    top: WHITE,
  },
  {
    id: 'forehead',
    weight: 1,
    layer: `<path d="M26 0H94C92 20 82 38 70 46C64 50 56 50 50 46C38 38 28 20 26 0Z" fill="${ORANGE}"/><path d="M120 0H78C78 18 86 34 100 42C108 47 115 48 120 48Z" fill="${INK}"/>`,
    under: [WHITE, WHITE],
    top: ORANGE,
  },
]

export const COATS: readonly CoatOption[] = [
  {
    id: 'calico',
    weight: 11,
    base: WHITE,
    nose: ORANGE,
    mouth: INK,
    edge: [WHITE, ORANGE, INK],
    patterns: CALICO_PATTERNS,
  },
  {
    id: 'orange',
    weight: 3,
    base: ORANGE,
    layer: stripes(DEEP_ORANGE, true),
    under: [ORANGE, ORANGE],
    nose: '#B4531A',
    mouth: INK,
    edge: [ORANGE, DEEP_ORANGE],
  },
  {
    id: 'orange-white',
    weight: 3,
    base: WHITE,
    layer: `<path d="M0 0H120V62C110 64 102 57 94 58C86 59 82 54 74 53C67 52 64 57 60 57C56 57 53 51 46 53C38 55 34 60 26 59C18 58 10 64 0 62Z" fill="${ORANGE}"/>${stripes(DEEP_ORANGE, false)}`,
    under: [WHITE, WHITE],
    top: ORANGE,
    nose: ORANGE,
    mouth: INK,
    edge: [WHITE, ORANGE],
  },
  {
    id: 'black',
    weight: 3,
    base: INK,
    under: [INK, INK],
    nose: ORANGE,
    mouth: '#F6EEE2',
    edge: [INK],
  },
  {
    id: 'white',
    weight: 3,
    base: WHITE,
    under: [WHITE, WHITE],
    nose: ORANGE,
    mouth: INK,
    edge: [WHITE],
  },
  {
    id: 'tuxedo',
    weight: 3,
    base: INK,
    layer: `<path d="M61 52C58 60 55 67 53 74C45 76 37 82 35 92C33 106 87 106 85 92C83 82 75 76 67 74C65 67 63 60 61 52Z" fill="${WHITE}"/>`,
    under: [INK, INK],
    nose: ORANGE,
    mouth: INK,
    edge: [INK, WHITE],
  },
  {
    id: 'tabby',
    weight: 3,
    base: '#A98E70',
    layer: muzzle('#E3D3BE') + stripes('#6E5843', true),
    under: ['#A98E70', '#A98E70'],
    nose: '#C9705A',
    mouth: INK,
    edge: ['#A98E70', '#6E5843'],
  },
  {
    id: 'blue',
    weight: 3,
    base: '#8F99A5',
    layer: muzzle('#BAC2CB'),
    under: ['#8F99A5', '#8F99A5'],
    nose: '#C98C86',
    mouth: INK,
    edge: ['#8F99A5'],
  },
  {
    id: 'siamese',
    weight: 3,
    base: '#F1E3CE',
    layer: `<path d="M60 58C46 58 33 68 33 82C33 98 46 104 60 104C74 104 87 98 87 82C87 68 74 58 60 58Z" fill="${SIAMESE_POINT}"/><path d="M0 0H42C40 14 34 26 16 32L0 36Z" fill="${SIAMESE_POINT}"/><path d="M120 0H78C80 14 86 26 104 32L120 36Z" fill="${SIAMESE_POINT}"/>`,
    under: [SIAMESE_POINT, SIAMESE_POINT],
    forceEyeLook: 'blue',
    nose: '#D79A8A',
    mouth: '#F1E3CE',
    edge: ['#F1E3CE', SIAMESE_POINT],
  },
  {
    id: 'tortoiseshell',
    weight: 3,
    base: INK,
    layer: `<path d="M58 24C68 30 80 28 92 22L120 0V52C110 54 100 48 90 50C80 52 70 42 58 24Z" fill="${DEEP_ORANGE}"/><path d="M0 84C10 80 20 86 28 82C36 78 44 88 41 96L40 120H0Z" fill="${DEEP_ORANGE}"/>`,
    under: [INK, INK],
    top: DEEP_ORANGE,
    nose: ORANGE,
    mouth: '#F6EEE2',
    edge: [INK, DEEP_ORANGE],
  },
  {
    id: 'cream',
    weight: 3,
    base: '#F4D6AE',
    layer: stripes('#E2AE72', true),
    under: ['#F4D6AE', '#F4D6AE'],
    nose: DEEP_ORANGE,
    mouth: INK,
    edge: ['#F4D6AE'],
  },
  {
    id: 'alien',
    weight: 3,
    base: ALIEN_GREEN,
    front: `<path d="M53.5 31L49 10M66.5 31L71 10" stroke="${ALIEN_STEM}" stroke-width="3.4" stroke-linecap="round"/><circle cx="49" cy="9" r="4.8" fill="${ALIEN_TIP}"/><circle cx="71" cy="9" r="4.8" fill="${ALIEN_TIP}"/>`,
    noTopAccessory: true,
    under: [ALIEN_GREEN, ALIEN_GREEN],
    forceEyeLook: 'plain',
    nose: ALIEN_STEM,
    mouth: INK,
    edge: [ALIEN_GREEN, ALIEN_STEM, ALIEN_TIP],
  },
]
