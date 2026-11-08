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
import { COATS } from './coats'
import { INK, ORANGE, YELLOW } from './color'
import type { AccessoryOption, EarOption, MeowCatalog } from './types'

// Released ids are permanent: renaming or reusing one reshuffles its users.
// To add a part, append it; give it `availableFrom` to leave old cats as is.

const EARS: readonly EarOption[] = [
  {
    id: 'soft',
    weight: 1,
    path: 'M22 54L23 27C23 15 29 12 35 17L48 29Q60 25 72 29L85 17C91 12 97 15 97 27L98 54',
  },
  {
    id: 'round',
    weight: 1,
    path: 'M22 54C17 38 20 23 29 20C37 18 44 24 49 29Q60 25 71 29C76 24 83 18 91 20C100 23 103 38 98 54',
  },
  {
    id: 'big',
    weight: 1,
    path: 'M22 54C12 36 14 14 26 12C36 11 45 21 50 29Q60 25 70 29C75 21 84 11 94 12C106 14 108 36 98 54',
  },
  {
    id: 'tall',
    weight: 1,
    path: 'M22 54L24 19C24 7 31 3 37 10L49 29Q60 25 71 29L83 10C89 3 96 7 96 19L98 54',
  },
  {
    id: 'out',
    weight: 1,
    path: 'M22 54L15 31C12 21 17 15 26 19L48 30Q60 26 72 30L94 19C103 15 108 21 105 31L98 54',
  },
  {
    id: 'tuft',
    weight: 1,
    path: 'M22 54L23 27C23 20 24 16 26 14C25 10 26 7 28 5C28.5 9 30 12 32 14.5C33.2 15 34.2 15.8 35 17L48 29Q60 25 72 29L85 17C85.8 15.8 86.8 15 88 14.5C90 12 91.5 9 92 5C94 7 95 10 94 14C96 16 97 20 97 27L98 54',
  },
  {
    id: 'tilt',
    weight: 1,
    path: 'M22 54L23 27C23 15 29 12 35 17L48 29Q60 25 72 29L95 22C103 20 107 26 103 31L98 54',
  },
]

const ACCESSORIES: readonly AccessoryOption[] = [
  { id: 'none', weight: 1 },
  { id: 'bow', weight: 1 },
  { id: 'flower', weight: 1 },
  { id: 'glasses', weight: 1, onFace: true },
  { id: 'leaf', weight: 1, fixedColors: ['#6FA35F'], onTop: true },
  { id: 'star', weight: 1, fixedColors: [YELLOW] },
  { id: 'party', weight: 1, onTop: true },
  { id: 'crown', weight: 1, fixedColors: [YELLOW], onTop: true },
  { id: 'phones', weight: 1 },
  { id: 'code', weight: 1 },
  { id: 'tie', weight: 1 },
  { id: 'shades', weight: 1, onFace: true },
  { id: 'beanie', weight: 1, onTop: true },
  { id: 'collar', weight: 1 },
  { id: 'aid', weight: 1, fixedColors: ['#F2C48D'], onFace: true },
  { id: 'ahoge', weight: 1, onTop: true, furColored: true },
  { id: 'heart', weight: 1 },
  { id: 'halo', weight: 1, fixedColors: ['#F2C94C'], onTop: true },
  { id: 'horns', weight: 1, fixedColors: ['#C94A3D'], onTop: true },
  { id: 'fish', weight: 1, fixedColors: ['#A9B7C6'], onFace: true },
  { id: 'pixel', weight: 1, onFace: true },
  { id: 'banana', weight: 1, fixedColors: ['#F5D547'], onTop: true },
  { id: 'duck', weight: 1, fixedColors: ['#F5D547'], onTop: true },
  { id: 'think', weight: 1 },
  { id: 'huh', weight: 1 },
  { id: 'sweat', weight: 1, fixedColors: ['#86C5EC'], onFace: true },
  {
    id: 'glasses-3d',
    weight: 1,
    fixedColors: ['#E5484D', '#3FC1D9'],
    onFace: true,
  },
]

export const MEOW_CATALOG: MeowCatalog = {
  coats: COATS,
  ears: EARS,
  eyes: [
    { id: 'oval', weight: 1 },
    { id: 'big', weight: 1 },
    { id: 'round', weight: 1 },
    { id: 'small', weight: 1 },
    { id: 'happy', weight: 1 },
    { id: 'sleepy', weight: 1 },
    { id: 'wink', weight: 1 },
    { id: 'tear', weight: 1 },
    { id: 'heart', weight: 1 },
    { id: 'star', weight: 1 },
  ],
  eyeColors: [
    { id: 'amber', weight: 1, color: '#F2B33D' },
    { id: 'green', weight: 1, color: '#9CCB6B' },
    { id: 'blue', weight: 1, color: '#86B8EC' },
  ],
  mouths: [
    { id: 'none', weight: 1 },
    { id: 'w', weight: 1 },
    { id: 'smile', weight: 1 },
    { id: 'blep', weight: 1 },
    { id: 'open', weight: 1 },
  ],
  accessories: ACCESSORIES,
  accessoryColors: [
    { id: 'red', weight: 1, color: '#D9483B' },
    { id: 'orange', weight: 1, color: ORANGE },
    { id: 'blue', weight: 1, color: '#4E7FC0' },
    { id: 'green', weight: 1, color: '#5E9B57' },
    { id: 'pink', weight: 1, color: '#E77FA3' },
    { id: 'yellow', weight: 1, color: YELLOW },
    { id: 'purple', weight: 1, color: '#8C6BC8' },
    { id: 'ink', weight: 1, color: INK },
  ],
  backgrounds: [
    { id: 'apricot', weight: 1, color: '#F2B880' },
    { id: 'matcha', weight: 1, color: '#A9C79A' },
    { id: 'mint', weight: 1, color: '#8FBFB3' },
    { id: 'mist', weight: 1, color: '#9DB7DB' },
    { id: 'lavender', weight: 1, color: '#B9A7DA' },
    { id: 'rose', weight: 1, color: '#EBA7A7' },
    { id: 'mustard', weight: 1, color: '#E3C46B' },
    { id: 'cream', weight: 1, color: '#F6EEE2' },
    { id: 'celadon', weight: 1, color: '#7FA3A0' },
    { id: 'oat', weight: 1, color: '#C9B8A4' },
    { id: 'calico', weight: 1, color: ORANGE },
  ],
}
