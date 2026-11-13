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

import type { PricingModel } from '@/features/pricing/types'

import {
  isUnpricedModel,
  popularModels,
  tokenPriceSummary,
} from '../lib/meow-popular-models'

const SOLD = [
  'claude-haiku-5-5',
  'claude-opus-5-5',
  'claude-sonnet-5-5',
  'gpt-6-astra',
  'gpt-6.1-terra',
  'gpt-6.1-sol',
  'gpt-3.5-turbo-0125',
  'sora-2',
]

describe('popularModels', () => {
  it('features the two most used models of each family', () => {
    const ranked = [
      'sora-2',
      'gpt-6-astra',
      'claude-sonnet-5-5',
      'gpt-6.1-terra',
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]

    expect(popularModels('claude', ranked, SOLD)).toEqual([
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ])
    expect(popularModels('gpt', ranked, SOLD)).toEqual([
      'gpt-6-astra',
      'gpt-6.1-terra',
    ])
  })

  it('falls back to the CC Switch defaults without usage data', () => {
    expect(popularModels('claude', [], SOLD)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
    ])
    expect(popularModels('gpt', [], SOLD)).toEqual([
      'gpt-6.1-sol',
      'gpt-6.1-terra',
    ])
  })

  it('tops up a single ranked model with a default', () => {
    expect(popularModels('claude', ['claude-haiku-5-5'], SOLD)).toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ])
  })

  it('skips ranked models the site no longer sells', () => {
    expect(
      popularModels('claude', ['claude-opus-4-6', 'claude-sonnet-5-5'], SOLD)
    ).toEqual(['claude-sonnet-5-5', 'claude-opus-5-5'])
  })
})

describe('isUnpricedModel', () => {
  const model = (patch: Partial<PricingModel>): PricingModel => ({
    id: 1,
    model_name: 'gpt-6.1-sol',
    quota_type: 0,
    model_ratio: 37.5,
    completion_ratio: 2,
    enable_groups: ['default'],
    ...patch,
  })

  it('treats a token model on the fallback ratio as unpriced', () => {
    expect(isUnpricedModel(model({}))).toBe(true)
  })

  it('treats a model with a set ratio as priced', () => {
    expect(isUnpricedModel(model({ model_ratio: 2.5 }))).toBe(false)
  })

  it('treats a billing expression as priced', () => {
    expect(
      isUnpricedModel(
        model({ billing_mode: 'tiered_expr', billing_expr: 'p * 4 + c * 20' })
      )
    ).toBe(false)
  })

  it('treats a billing expression of zero prices as unpriced', () => {
    expect(
      isUnpricedModel(
        model({
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("base", p * 0 + c * 0)',
        })
      )
    ).toBe(true)
  })

  it('treats a per-request price as priced', () => {
    expect(isUnpricedModel(model({ quota_type: 1, model_price: 0.3 }))).toBe(
      false
    )
  })
})

describe('tokenPriceSummary', () => {
  const RATES = { priceRate: 1, usdExchangeRate: 1 }
  const model = (patch: Partial<PricingModel>): PricingModel => ({
    id: 1,
    model_name: 'claude-opus-5-5',
    quota_type: 0,
    model_ratio: 37.5,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...patch,
  })

  it('reads the input and output price of a billing expression', () => {
    const price = tokenPriceSummary(
      model({
        billing_mode: 'tiered_expr',
        billing_expr: 'tier("standard", p * 4 + cr * 0.2 + c * 20)',
      }),
      RATES
    )

    expect(price).toMatchObject({ tiered: false })
    expect(price?.input).toMatch(/\b4\b/)
    expect(price?.output).toMatch(/\b20\b/)
  })

  it('marks a context-length tiered expression and shows its first tier', () => {
    const price = tokenPriceSummary(
      model({
        billing_mode: 'tiered_expr',
        billing_expr:
          'len <= 272000 ? tier("short", p * 2 + c * 10) : tier("long", p * 4 + c * 15)',
      }),
      RATES
    )

    expect(price?.tiered).toBe(true)
    expect(price?.input).toMatch(/\b2\b/)
    expect(price?.output).toMatch(/\b10\b/)
  })

  it('has no token price for a per-request model', () => {
    expect(
      tokenPriceSummary(model({ quota_type: 1, model_price: 0.3 }), RATES)
    ).toBeNull()
  })
})
