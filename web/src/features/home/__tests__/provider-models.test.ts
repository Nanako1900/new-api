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
  pickProviderModels,
  PROVIDER_MODEL_LIMIT,
} from '../lib/provider-models'

test('models are matched by vendor name before model name', () => {
  const models = [
    { model_name: 'sonnet-latest', vendor_name: 'Anthropic' },
    { model_name: 'gpt-5', vendor_name: 'OpenAI' },
    { model_name: 'claude-proxy', vendor_name: 'OpenAI' },
  ]
  expect(pickProviderModels(models, 'claude')).toEqual(['sonnet-latest'])
  expect(pickProviderModels(models, 'gpt')).toEqual(['gpt-5', 'claude-proxy'])
})

test('models without a vendor fall back to matching the model name', () => {
  const models = [{ model_name: 'claude-haiku' }, { model_name: 'gemini-pro' }]
  expect(pickProviderModels(models, 'claude')).toEqual(['claude-haiku'])
  expect(pickProviderModels(models, 'gpt')).toEqual([])
})

test('chat models are listed before image models', () => {
  const models = [
    { model_name: 'gpt-image-2', vendor_name: 'OpenAI' },
    { model_name: 'gpt-6-sol', vendor_name: 'OpenAI' },
    { model_name: 'gpt-image-1.5', vendor_name: 'OpenAI' },
    { model_name: 'gpt-5.6-luna', vendor_name: 'OpenAI' },
  ]
  expect(pickProviderModels(models, 'gpt')).toEqual([
    'gpt-6-sol',
    'gpt-5.6-luna',
    'gpt-image-2',
    'gpt-image-1.5',
  ])
})

test('duplicate and blank names are skipped and the list is capped', () => {
  const models = [
    { model_name: ' ' },
    ...Array.from({ length: PROVIDER_MODEL_LIMIT + 2 }, (_, i) => ({
      model_name: `gpt-${i % (PROVIDER_MODEL_LIMIT + 1)}`,
    })),
  ]
  const names = pickProviderModels(models, 'gpt')
  expect(names).toHaveLength(PROVIDER_MODEL_LIMIT)
  expect(new Set(names).size).toBe(names.length)
})
