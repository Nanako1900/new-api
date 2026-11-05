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
import { expect, test } from 'vitest'

import {
  meowModelColorRange,
  modelColorHex,
  modelColorMap,
  PROVIDER_SERIES,
  vendorColorMap,
} from '../lib/meow-model-colors'
import { OTHER_SERIES } from '../lib/meow-usage'

const lightColors = (models: string[]) => modelColorMap(models, false)

test('Claude tiers get warm hues: opus brick, sonnet orange, haiku gold', () => {
  const colors = lightColors(['claude-opus', 'claude-sonnet', 'claude-haiku'])
  expect(colors).toEqual({
    'claude-opus': '#B4432F',
    'claude-sonnet': '#EE8A3C',
    'claude-haiku': '#D9A43A',
  })
})

test('GPT flagship takes the ink and mini models the blue', () => {
  const colors = lightColors(['gpt-6-sol', 'gpt-6-mini'])
  expect(colors).toEqual({ 'gpt-6-sol': '#1E1B17', 'gpt-6-mini': '#4C6EA6' })
})

test('OpenAI o-series models take GPT hues, other o-names stay other', () => {
  const colors = lightColors(['o3', 'o4-mini', 'omni-moderation'])
  expect(colors).toEqual({
    o3: '#1E1B17',
    'o4-mini': '#4C6EA6',
    'omni-moderation': '#7C9A40',
  })
})

test('dashboard colour range follows the theme it is given', () => {
  const domain = ['gpt-5', 'Other']
  expect(meowModelColorRange(domain, 'Other', false)).toEqual([
    '#1E1B17',
    '#CFC6B8',
  ])
  expect(meowModelColorRange(domain, 'Other', true)).toEqual([
    '#EDE6DC',
    '#5A544C',
  ])
})

test('models sharing a tier get distinct hues', () => {
  const colors = lightColors(['gpt-6-sol', 'gpt-6.1-terra', 'gpt-5.6-luna'])
  expect(new Set(Object.values(colors)).size).toBe(3)
})

test('a model keeps its colour whatever order the models come in', () => {
  const models = ['gpt-6-sol', 'claude-opus', 'gpt-6.1-terra']
  expect(lightColors(models)['gpt-6.1-terra']).toBe(
    lightColors([...models].reverse())['gpt-6.1-terra']
  )
})

test('more than six models of one vendor still get a colour each, in both themes', () => {
  const models = Array.from({ length: 24 }, (_, i) => `gemini-${i}`)
  for (const isDark of [false, true]) {
    const colors = modelColorHex(models, 'Other', isDark)
    expect(new Set(colors).size).toBe(models.length)
    for (const color of colors) expect(color).toMatch(/^#[0-9A-F]{6}$/)
  }
})

test('the seventh model of a vendor gets a lighter version of the first hue', () => {
  const models = Array.from({ length: 7 }, (_, i) => `gemini-${i}`)
  expect(Object.values(lightColors(models))).toContain('#AABD83')
})

test('provider series stack Claude at the bottom', () => {
  expect(PROVIDER_SERIES.map((series) => series.id)).toEqual([
    OTHER_SERIES,
    'gpt',
    'claude',
  ])
})

test('vendor colours: Anthropic orange, OpenAI ink, others earthy, Others grey', () => {
  const upstream = {
    Anthropic: '#d97757',
    OpenAI: '#10a37f',
    Google: '#4285f4',
    DeepSeek: '#7c5cff',
    Others: '#94a3b8',
  }
  expect(vendorColorMap(upstream, false)).toEqual({
    Anthropic: '#EE8A3C',
    OpenAI: '#1E1B17',
    Google: '#7C9A40',
    DeepSeek: '#8E4F86',
    Others: '#CFC6B8',
  })
  expect(vendorColorMap(upstream, true).OpenAI).toBe('#EDE6DC')
})

test('more than six other vendors each get their own colour', () => {
  const vendors = ['Google', 'DeepSeek', 'Qwen', 'Zhipu', 'Moonshot', 'xAI']
  const upstream = Object.fromEntries(
    [...vendors, 'Meta', 'Mistral'].map((name) => [name, '#000000'])
  )
  const colors = Object.values(vendorColorMap(upstream, false))
  expect(new Set(colors).size).toBe(colors.length)
})
