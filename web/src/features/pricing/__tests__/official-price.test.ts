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
  compareWithOfficialPrice,
  officialPriceFactor,
} from '../lib/official-price'
import {
  formatOfficialRequestPrice,
  formatOfficialTokenPrice,
} from '../lib/price'
import type { PricingModel } from '../types'

const STANDARD = { showRechargePrice: false, priceRate: 4, usdExchangeRate: 8 }
const RECHARGE = { ...STANDARD, showRechargePrice: true }

const SONNET: PricingModel = {
  id: 1,
  model_name: 'claude-sonnet',
  quota_type: 0,
  model_ratio: 1.5,
  completion_ratio: 5,
  cache_ratio: 0.1,
  enable_groups: ['official'],
}
const TOOL: PricingModel = {
  id: 2,
  model_name: 'claude-tool',
  quota_type: 1,
  model_price: 0.04,
  model_ratio: 0,
  completion_ratio: 0,
  enable_groups: ['official'],
}

describe('officialPriceFactor', () => {
  it('returns the group ratio when standard prices are shown', () => {
    expect(officialPriceFactor(0.3, STANDARD)).toBe(0.3)
  })

  it('applies the recharge rate when recharge prices are shown', () => {
    expect(officialPriceFactor(1.5, RECHARGE)).toBe(0.75)
  })

  it('keeps the group ratio when the exchange rate is not positive', () => {
    expect(officialPriceFactor(0.5, { ...RECHARGE, usdExchangeRate: 0 })).toBe(
      0.5
    )
  })
})

describe('compareWithOfficialPrice', () => {
  it('reports a discount when the factor is below 1', () => {
    expect(compareWithOfficialPrice(0.3)).toEqual({
      kind: 'discount',
      factor: 0.3,
    })
  })

  it('reports free when the factor is 0', () => {
    expect(compareWithOfficialPrice(0)).toEqual({ kind: 'free' })
  })

  it('treats a factor that displays as 1 as the official price', () => {
    expect(compareWithOfficialPrice(1.004)).toEqual({ kind: 'same' })
    expect(compareWithOfficialPrice(0.996)).toEqual({ kind: 'same' })
  })

  it('reports a markup when the factor is above 1', () => {
    expect(compareWithOfficialPrice(1.5)).toEqual({
      kind: 'markup',
      factor: 1.5,
    })
  })

  it('treats an invalid factor as the official price', () => {
    expect(compareWithOfficialPrice(Number.NaN)).toEqual({ kind: 'same' })
    expect(compareWithOfficialPrice(-1)).toEqual({ kind: 'same' })
  })
})

describe('official price formatting', () => {
  it('formats token prices per 1M tokens before any group ratio', () => {
    expect(formatOfficialTokenPrice(SONNET, 'input', 'M')).toBe('$3')
    expect(formatOfficialTokenPrice(SONNET, 'output', 'M')).toBe('$15')
    expect(formatOfficialTokenPrice(SONNET, 'cache', 'M')).toBe('$0.3')
  })

  it('formats the per-request price before any group ratio', () => {
    expect(formatOfficialRequestPrice(TOOL)).toBe('$0.04')
  })
})
