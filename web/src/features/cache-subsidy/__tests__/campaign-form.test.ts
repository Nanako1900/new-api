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
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  getCampaignFormDefaults,
  getCampaignFormSchema,
  transformCampaignToFormValues,
  transformFormToPayload,
  type CampaignFormValues,
} from '../lib'
import type { Campaign } from '../types'

const t = i18next.t.bind(i18next)

function validValues(
  overrides: Partial<CampaignFormValues> = {}
): CampaignFormValues {
  return {
    name: 'November cache refund',
    description: '',
    window_start: new Date('2026-11-13T00:00:00Z'),
    window_end: new Date('2026-11-20T00:00:00Z'),
    model_rules: ['claude*', 'gpt*'],
    include_cache_writes: true,
    subsidy_percent: 75,
    claim_deadline: new Date('2026-12-20T00:00:00Z'),
    per_user_cap_amount: 0,
    min_subsidy_amount: 0,
    ...overrides,
  }
}

function errorPaths(values: CampaignFormValues): string[] {
  const result = getCampaignFormSchema(t).safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => issue.path.join('.'))
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      displayInCurrency: true,
      quotaDisplayType: 'USD',
      quotaPerUnit: 500000,
      usdExchangeRate: 1,
      customCurrencySymbol: '¤',
      customCurrencyExchangeRate: 1,
    },
  })
})

afterEach(() => {
  localStorage.clear()
})

describe('campaign form defaults', () => {
  test('a new campaign starts on 2026-11-13 00:00 local time with Claude and GPT at 75% including writes', () => {
    const defaults = getCampaignFormDefaults(new Date(2026, 10, 23, 9, 30))

    expect(defaults.window_start).toEqual(new Date(2026, 10, 13, 0, 0, 0))
    expect(defaults.window_end).toBeNull()
    expect(defaults.model_rules).toEqual(['claude*', 'gpt*'])
    expect(defaults.include_cache_writes).toBe(true)
    expect(defaults.subsidy_percent).toBe(75)
    expect(defaults.claim_deadline).toEqual(new Date(2026, 11, 23, 9, 30))
    expect(defaults.per_user_cap_amount).toBe(0)
  })
})

describe('campaign form validation', () => {
  test('accepts a complete campaign', () => {
    expect(errorPaths(validValues())).toEqual([])
  })

  test('rejects a window that does not end after it starts', () => {
    expect(
      errorPaths(validValues({ window_end: new Date('2026-11-13T00:00:00Z') }))
    ).toEqual(['window_end'])
  })

  test('rejects a claim deadline before the window ends', () => {
    expect(
      errorPaths(
        validValues({ claim_deadline: new Date('2026-11-19T00:00:00Z') })
      )
    ).toEqual(['claim_deadline'])
  })

  test('requires the window end and at least one model rule', () => {
    expect(
      errorPaths(validValues({ window_end: null, model_rules: [] }))
    ).toEqual(expect.arrayContaining(['window_end', 'model_rules']))
  })

  test('rejects a percentage above 100, below 0 or left empty', () => {
    expect(errorPaths(validValues({ subsidy_percent: 101 }))).toEqual([
      'subsidy_percent',
    ])
    expect(errorPaths(validValues({ subsidy_percent: -1 }))).toEqual([
      'subsidy_percent',
    ])
    expect(errorPaths(validValues({ subsidy_percent: Number.NaN }))).toEqual([
      'subsidy_percent',
    ])
  })

  test('rejects a minimum above a set per-user cap but allows any minimum without a cap', () => {
    expect(
      errorPaths(validValues({ per_user_cap_amount: 5, min_subsidy_amount: 6 }))
    ).toEqual(['min_subsidy_amount'])
    expect(
      errorPaths(validValues({ per_user_cap_amount: 0, min_subsidy_amount: 6 }))
    ).toEqual([])
  })
})

describe('campaign payload transform', () => {
  test('sends unix seconds, trimmed unique rules and amounts in quota units', () => {
    const payload = transformFormToPayload(
      validValues({
        name: '  November cache refund ',
        model_rules: ['claude*', ' gpt* ', 'claude*'],
        per_user_cap_amount: 20,
        min_subsidy_amount: 0.01,
      })
    )

    expect(payload).toEqual({
      name: 'November cache refund',
      description: '',
      window_start: Date.UTC(2026, 10, 13) / 1000,
      window_end: Date.UTC(2026, 10, 20) / 1000,
      model_rules: ['claude*', 'gpt*'],
      include_cache_writes: true,
      subsidy_percent: 75,
      claim_deadline: Date.UTC(2026, 11, 20) / 1000,
      per_user_cap_quota: 10_000_000,
      min_subsidy_quota: 5_000,
    })
  })

  test('converts amounts through the CNY exchange rate', () => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        displayInCurrency: true,
        quotaDisplayType: 'CNY',
        quotaPerUnit: 500000,
        usdExchangeRate: 8,
        customCurrencySymbol: '¤',
        customCurrencyExchangeRate: 1,
      },
    })

    const payload = transformFormToPayload(
      validValues({ per_user_cap_amount: 16 })
    )

    expect(payload.per_user_cap_quota).toBe(1_000_000)
  })

  test('a saved campaign becomes the same form values it was created from', () => {
    const campaign = {
      id: 3,
      name: 'November cache refund',
      description: 'Thanks for your patience',
      status: 'draft',
      window_start: Date.UTC(2026, 10, 13) / 1000,
      window_end: Date.UTC(2026, 10, 20) / 1000,
      model_rules: ['claude*'],
      include_cache_writes: false,
      subsidy_percent: 50,
      claim_deadline: Date.UTC(2026, 11, 20) / 1000,
      per_user_cap_quota: 10_000_000,
      min_subsidy_quota: 0,
    } as Campaign

    expect(transformCampaignToFormValues(campaign)).toEqual({
      name: 'November cache refund',
      description: 'Thanks for your patience',
      window_start: new Date('2026-11-13T00:00:00Z'),
      window_end: new Date('2026-11-20T00:00:00Z'),
      model_rules: ['claude*'],
      include_cache_writes: false,
      subsidy_percent: 50,
      claim_deadline: new Date('2026-12-20T00:00:00Z'),
      per_user_cap_amount: 20,
      min_subsidy_amount: 0,
    })
  })
})
