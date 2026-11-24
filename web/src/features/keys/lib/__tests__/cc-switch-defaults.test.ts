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
import { describe, expect, it } from 'vitest'

import {
  antigravityModelName,
  ccSwitchModelChoices,
  defaultCCSwitchApp,
  defaultCCSwitchModels,
  keyModels,
  keyRequestGroups,
} from '../cc-switch-defaults'

const SITE_MODELS = [
  'claude-haiku-5-5',
  'codex-auto-review',
  'claude-opus-5-5',
  'gpt-6-astra',
  'gpt-6.1-terra',
  'gpt-6.1-sol',
  'gpt-6-sol',
  'gpt-5.6-sol',
  'gpt-3.5-turbo-0125',
  'claude-sonnet-5-5',
  'gemini-3.8-flash',
  'gemini-4-carbon',
  'gemini-4-neon',
  'sora-2',
]

describe('ccSwitchModelChoices', () => {
  it('offers Codex its GPT and codex models only, without Gemini models', () => {
    expect(ccSwitchModelChoices('codex', SITE_MODELS)).toEqual([
      'codex-auto-review',
      'gpt-6-astra',
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-sol',
      'gpt-5.6-sol',
      'gpt-3.5-turbo-0125',
    ])
  })

  it('offers Claude Code the Claude models only', () => {
    expect(ccSwitchModelChoices('claude', SITE_MODELS)).toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
  })

  it.each(['gemini', 'agy'] as const)(
    'offers %s the Gemini models only',
    (app) => {
      expect(ccSwitchModelChoices(app, SITE_MODELS)).toEqual([
        'gemini-3.8-flash',
        'gemini-4-carbon',
        'gemini-4-neon',
      ])
    }
  )
})

describe('defaultCCSwitchModels', () => {
  it('fills Claude with Opus as the main model and each family slot', () => {
    expect(defaultCCSwitchModels('claude', SITE_MODELS)).toEqual({
      model: 'claude-opus-5-5',
      haikuModel: 'claude-haiku-5-5',
      sonnetModel: 'claude-sonnet-5-5',
      opusModel: 'claude-opus-5-5',
    })
  })

  it('picks the newest version of a family and skips dated snapshots', () => {
    const models = [
      'claude-opus-4-6',
      'claude-opus-5-5',
      'claude-opus-5',
      'claude-opus-5-6-20270101',
    ]

    expect(defaultCCSwitchModels('claude', models).opusModel).toBe(
      'claude-opus-5-5'
    )
  })

  it('accepts a bare family alias but prefers a versioned model', () => {
    expect(
      defaultCCSwitchModels('claude', ['claude-opus', 'claude-haiku'])
    ).toMatchObject({ model: 'claude-opus', haikuModel: 'claude-haiku' })
    expect(
      defaultCCSwitchModels('claude', ['claude-opus', 'claude-opus-5-5'])
        .opusModel
    ).toBe('claude-opus-5-5')
  })

  it('falls back to Sonnet as the Claude main model when Opus is missing', () => {
    const result = defaultCCSwitchModels('claude', ['claude-sonnet-5-5'])

    expect(result.model).toBe('claude-sonnet-5-5')
    expect(result.opusModel).toBe('')
  })

  it('fills Codex with the newest GPT sol model', () => {
    expect(defaultCCSwitchModels('codex', SITE_MODELS)).toEqual({
      model: 'gpt-6.1-sol',
    })
  })

  it('falls back to the newest GPT model when no sol model exists', () => {
    const models = ['gpt-6-astra', 'gpt-6.1-terra', 'gpt-5.6-luna']

    expect(defaultCCSwitchModels('codex', models).model).toBe('gpt-6.1-terra')
  })

  it.each(['gemini', 'agy'] as const)(
    'fills %s with the newest Gemini neon model',
    (app) => {
      expect(defaultCCSwitchModels(app, SITE_MODELS)).toEqual({
        model: 'gemini-4-neon',
      })
      expect(
        defaultCCSwitchModels(app, ['gemini-4-neon', 'gemini-4.5-neon']).model
      ).toBe('gemini-4.5-neon')
    }
  )

  it('leaves Codex empty when the user has only Gemini models', () => {
    expect(
      defaultCCSwitchModels('codex', ['gemini-3.8-flash', 'gemini-4-neon'])
    ).toEqual({ model: '' })
  })

  it('falls back to the newest Gemini model when no neon model exists', () => {
    const models = ['gemini-3.8-flash', 'gemini-4-carbon']

    expect(defaultCCSwitchModels('gemini', models).model).toBe(
      'gemini-4-carbon'
    )
  })

  it('leaves every field empty when the user has no matching models', () => {
    expect(defaultCCSwitchModels('claude', ['sora-2'])).toEqual({
      model: '',
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
    })
    expect(defaultCCSwitchModels('codex', [])).toEqual({ model: '' })
    expect(defaultCCSwitchModels('gemini', ['gpt-6.1-sol'])).toEqual({
      model: '',
    })
  })
})

describe('keyRequestGroups', () => {
  it('uses the key group when it names one', () => {
    expect(keyRequestGroups({ group: 'GPT Pro号池' }, 'default', [])).toEqual([
      'GPT Pro号池',
    ])
  })

  it("uses the user's own group when the key has none", () => {
    expect(keyRequestGroups({ group: '' }, 'default', [])).toEqual(['default'])
    expect(keyRequestGroups({ group: null }, '', [])).toEqual([])
  })

  it("uses an Auto key's own list, else the user's global Auto list", () => {
    expect(
      keyRequestGroups(
        { group: 'auto', auto_groups: ['Claude Max', 'Gemini Ultra'] },
        'default',
        ['GPT Pro号池']
      )
    ).toEqual(['Claude Max', 'Gemini Ultra'])
    expect(
      keyRequestGroups({ group: 'auto', auto_groups: null }, 'default', [
        'GPT Pro号池',
      ])
    ).toEqual(['GPT Pro号池'])
  })
})

describe('keyModels', () => {
  const PRICING = [
    { model_name: 'claude-opus-5-5', enable_groups: ['Claude Max'] },
    { model_name: 'gemini-4-neon', enable_groups: ['Gemini Ultra'] },
    { model_name: 'gpt-6-astra', enable_groups: ['GPT Pro号池'] },
    { model_name: 'gpt-6.1-sol', enable_groups: ['GPT Pro号池'] },
    { model_name: 'unlisted-model', enable_groups: null },
  ]

  it('keeps the models served in any of the groups', () => {
    expect(keyModels({}, ['Claude Max', 'Gemini Ultra'], PRICING)).toEqual([
      'claude-opus-5-5',
      'gemini-4-neon',
    ])
    expect(keyModels({}, [], PRICING)).toEqual([])
  })

  it('narrows them to the model limits when the key has limits on', () => {
    const key = {
      model_limits_enabled: true,
      model_limits: 'gpt-6-astra, claude-opus-5-5',
    }

    expect(keyModels(key, ['GPT Pro号池'], PRICING)).toEqual(['gpt-6-astra'])
    expect(
      keyModels(
        { ...key, model_limits_enabled: false },
        ['GPT Pro号池'],
        PRICING
      )
    ).toEqual(['gpt-6-astra', 'gpt-6.1-sol'])
  })
})

describe('defaultCCSwitchApp', () => {
  it('picks the client whose own family the key can call', () => {
    expect(defaultCCSwitchApp(['gpt-6.1-sol'])).toBe('codex')
    expect(defaultCCSwitchApp(['gemini-4-neon', 'claude-opus-5-5'])).toBe(
      'claude'
    )
  })

  it('picks Gemini CLI rather than Antigravity for Gemini models', () => {
    expect(defaultCCSwitchApp(['gemini-4-neon'])).toBe('gemini')
  })

  it('returns null when no client runs any of the models', () => {
    expect(defaultCCSwitchApp(['deepseek-flash'])).toBeNull()
    expect(defaultCCSwitchApp([])).toBeNull()
  })
})

describe('antigravityModelName', () => {
  it.each([
    ['gemini-4-neon', 'Gemini 4 Neon (High)'],
    ['gemini-4-hydrogen', 'Gemini 4 Hydrogen (High)'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash (High)'],
  ])('names %s by its High display name', (model, name) => {
    expect(antigravityModelName(model)).toBe(name)
  })

  it('keeps a display name the user typed and an empty model as they are', () => {
    expect(antigravityModelName('Gemini 4 Neon (Low)')).toBe(
      'Gemini 4 Neon (Low)'
    )
    expect(antigravityModelName('')).toBe('')
  })
})
