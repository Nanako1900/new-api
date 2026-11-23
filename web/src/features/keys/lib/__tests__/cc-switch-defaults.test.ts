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
  ccSwitchModelChoices,
  defaultCCSwitchModels,
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
  it('offers Codex its GPT and codex models first, then the Gemini models', () => {
    expect(ccSwitchModelChoices('codex', SITE_MODELS)).toEqual([
      'codex-auto-review',
      'gpt-6-astra',
      'gpt-6.1-terra',
      'gpt-6.1-sol',
      'gpt-6-sol',
      'gpt-5.6-sol',
      'gpt-3.5-turbo-0125',
      'gemini-3.8-flash',
      'gemini-4-carbon',
      'gemini-4-neon',
    ])
  })

  it('keeps the Codex default on GPT when Gemini models are offered too', () => {
    const models = ccSwitchModelChoices('codex', SITE_MODELS)

    expect(defaultCCSwitchModels('codex', models).model).toBe('gpt-6.1-sol')
  })

  it('offers Claude Code the Claude models only', () => {
    expect(ccSwitchModelChoices('claude', SITE_MODELS)).toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
  })

  it('offers Gemini CLI the Gemini models only', () => {
    expect(ccSwitchModelChoices('gemini', SITE_MODELS)).toEqual([
      'gemini-3.8-flash',
      'gemini-4-carbon',
      'gemini-4-neon',
    ])
  })
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

  it('fills Gemini CLI with the newest Gemini neon model', () => {
    expect(defaultCCSwitchModels('gemini', SITE_MODELS)).toEqual({
      model: 'gemini-4-neon',
    })
    expect(
      defaultCCSwitchModels('gemini', ['gemini-4-neon', 'gemini-4.5-neon'])
        .model
    ).toBe('gemini-4.5-neon')
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
