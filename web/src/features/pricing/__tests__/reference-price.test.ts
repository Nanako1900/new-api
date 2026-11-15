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

import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'

import { getReferencePriceComparison } from '../lib/reference-price'
import type { PricingModel, PricingReference } from '../types'

const EXPRESSION =
  'tier("standard", p * 4 + cr * 0.2 + cc * 5 + cc1h * 8 + c * 20)'
const MODEL: PricingModel = {
  id: 1,
  model_name: 'claude-opus-5-5',
  quota_type: 0,
  model_ratio: 0,
  completion_ratio: 0,
  enable_groups: ['CC Max'],
  billing_mode: 'tiered_expr',
  billing_expr: EXPRESSION,
}
const REFERENCE: PricingReference = {
  source_url:
    'https://basellm.github.io/llm-metadata/api/newapi/ratio_config-v1-base.json',
  currency: 'USD',
  usd_to_cny_rate: 7.3,
  updated_at: 1_800_000_000,
  stale: false,
  models: {
    'claude-opus-5-5': {
      billing_mode: 'tiered_expr',
      billing_expr: EXPRESSION,
    },
  },
}
const CNY = {
  ...DEFAULT_CURRENCY_CONFIG,
  quotaDisplayType: 'CNY' as const,
  usdExchangeRate: 1,
}

function compare(site: string, reference: string) {
  return getReferencePriceComparison(
    { ...MODEL, billing_expr: site },
    1,
    {
      ...REFERENCE,
      models: {
        [MODEL.model_name]: {
          billing_mode: 'tiered_expr',
          billing_expr: reference,
        },
      },
    },
    DEFAULT_CURRENCY_CONFIG
  )
}

describe('reference price comparison', () => {
  it('compares the actual ¥5.2 charge with the separately converted ¥29.2 reference', () => {
    expect(
      getReferencePriceComparison(MODEL, 1.3, REFERENCE, CNY)?.factor
    ).toBeCloseTo(5.2 / 29.2)
    expect(
      getReferencePriceComparison(MODEL, 1.3, REFERENCE, CNY)?.priceCount
    ).toBe(5)
  })

  it('uses the least favorable ratio across all prices and corresponding context tiers', () => {
    const site =
      'len <= 200000 ? tier("short", p * 1 + c * 2) : tier("long", p * 1 + c * 8)'
    const reference =
      'len <= 200000 ? tier("base", c * 8 + p * 2) : tier("extended", p * 4 + c * 16)'
    expect(compare(site, reference)?.factor).toBe(0.5)
  })

  it.each([
    [
      'missing cache price',
      'tier("base", p * 1 + c * 4)',
      'tier("base", p * 2 + c * 8 + cr * 0.2)',
    ],
    [
      'different conditions',
      'len < 200000 ? tier("a", p * 1) : tier("b", p * 2)',
      'len <= 200000 ? tier("a", p * 2) : tier("b", p * 4)',
    ],
    [
      'different quantity semantics',
      'tier("base", max(len - ai, 0) * 1 + ai * 2 + c * 4)',
      'tier("base", p * 2 + ai * 4 + c * 8)',
    ],
    [
      'zero reference price',
      'tier("base", p * 0 + c * 1)',
      'tier("base", p * 0 + c * 2)',
    ],
    [
      'request multiplier',
      '(tier("base", p * 1)) * (param("mode") == "fast" ? 2 : 1)',
      'tier("base", p * 2)',
    ],
    ['arbitrary expression', 'p * c', 'tier("base", p * 2 + c * 8)'],
    ['different units', 'tier("base", fixed(0.01))', 'tier("base", p * 2)'],
    [
      'different time rules',
      'hour("UTC") < 12 ? tier("am", p * 1) : tier("pm", p * 2)',
      'hour("UTC") < 15 ? tier("am", p * 2) : tier("pm", p * 4)',
    ],
  ])('omits a comparison for %s', (_name, site, reference) => {
    expect(compare(site, reference)).toBeNull()
  })

  it('preserves valid zero prices and an explicitly free group', () => {
    expect(
      compare('tier("free", p * 0 + c * 0)', 'tier("base", p * 4 + c * 20)')
        ?.factor
    ).toBe(0)
    expect(getReferencePriceComparison(MODEL, 0, REFERENCE, CNY)?.factor).toBe(
      0
    )
  })

  it('does not compare aliases or task providers to a token reference', () => {
    expect(
      getReferencePriceComparison(
        { ...MODEL, model_name: 'claude-opus-5-5-alias' },
        1,
        REFERENCE,
        CNY
      )
    ).toBeNull()
    expect(
      getReferencePriceComparison(
        {
          ...MODEL,
          billing_usage_schema: { tokens: { type: 'number', unit: 'token' } },
        },
        1,
        REFERENCE,
        CNY
      )
    ).toBeNull()
    expect(
      getReferencePriceComparison(
        {
          ...MODEL,
          billing_plugin_variants: [
            {
              plugin_key: 'p',
              plugin_name: 'Provider',
              billing_expr: EXPRESSION,
              billing_usage_schema: {},
            },
          ],
        },
        1,
        REFERENCE,
        CNY
      )
    ).toBeNull()
  })

  it('uses the configured currency and suppresses unsupported currencies or invalid FX', () => {
    expect(
      getReferencePriceComparison(
        MODEL,
        1.3,
        REFERENCE,
        DEFAULT_CURRENCY_CONFIG
      )?.factor
    ).toBeCloseTo(1.3)
    expect(
      getReferencePriceComparison(MODEL, 1.3, REFERENCE, {
        ...CNY,
        usdExchangeRate: 2,
      })?.factor
    ).toBeCloseTo(10.4 / 29.2)
    for (const quotaDisplayType of ['CUSTOM', 'TOKENS'] as const) {
      expect(
        getReferencePriceComparison(MODEL, 1, REFERENCE, {
          ...CNY,
          quotaDisplayType,
        })
      ).toBeNull()
    }
    expect(
      getReferencePriceComparison(
        MODEL,
        1,
        { ...REFERENCE, usd_to_cny_rate: 0 },
        CNY
      )
    ).toBeNull()
    expect(
      getReferencePriceComparison(MODEL, 1, REFERENCE, {
        ...CNY,
        usdExchangeRate: Number.NaN,
      })
    ).toBeNull()
    expect(getReferencePriceComparison(MODEL, 1, undefined, CNY)).toBeNull()
    expect(
      getReferencePriceComparison(
        MODEL,
        1,
        { ...REFERENCE, usd_to_cny_rate: Number.MAX_VALUE },
        CNY
      )
    ).toBeNull()
  })
})
