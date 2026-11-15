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
import { QUOTA_TYPE_VALUES } from '../constants'
import type { PricingModel, PricingReference } from '../types'
import {
  getCurrentTimePricingTiers,
  splitBillingExprAndRequestRules,
} from './billing-expr'
import {
  formatDynamicUnitPrice,
  getDynamicPricingSummary,
  isUnconfiguredTaskUsageModel,
} from './dynamic-price'
import { getConfiguredGroupRatio } from './model-helpers'
import { formatFixedPrice, formatGroupPrice } from './price'

export type MeowPriceOptions = {
  priceRate: number
  usdExchangeRate: number
  groupRatio: Record<string, number>
  reference?: PricingReference
}

type ChannelPrices =
  | {
      kind: 'token'
      values: string[]
      variable: boolean[]
    }
  | { kind: 'request'; price: string }
  | { kind: 'dynamic' }

/** Only separable token expressions belong in the three token-price columns. */
export function getMeowChannelPrices(
  model: PricingModel,
  group: string,
  prices: MeowPriceOptions,
  now?: Date
): ChannelPrices {
  const options = {
    tokenUnit: 'M' as const,
    groupRatioMultiplier: getConfiguredGroupRatio(prices.groupRatio, group),
    now,
  }
  const dynamic = getDynamicPricingSummary(model, options)
  if (dynamic) {
    const tiers = dynamic.isTimePricing
      ? (getCurrentTimePricingTiers(
          splitBillingExprAndRequestRules(model.billing_expr || '').billingExpr,
          now ?? new Date()
        ) ?? dynamic.tiers)
      : dynamic.tiers
    const tokenFields = ['inputPrice', 'outputPrice', 'cacheReadPrice']
    const supportedFields = new Set([
      ...tokenFields,
      'cacheCreatePrice',
      'cacheCreate1hPrice',
      'cacheCreate12hPrice',
    ])
    if (
      dynamic.isTaskUsage ||
      dynamic.isSpecialExpression ||
      dynamic.isMixedBilling ||
      dynamic.hasRequestRules ||
      tiers.length === 0 ||
      tiers.some(
        (tier) =>
          'unitPrices' in tier ||
          tier.billingUnit === 'request' ||
          Object.keys(tier).some(
            (field) => field.endsWith('Price') && !supportedFields.has(field)
          )
      )
    ) {
      return { kind: 'dynamic' }
    }
    const values: string[] = []
    const variable: boolean[] = []
    for (const field of tokenFields) {
      const amounts = tiers.flatMap((tier) => {
        if ('unitPrices' in tier) return []
        const value = tier[field]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0
          ? [value]
          : []
      })
      // An absent price in just some tiers is not a zero price.
      if (amounts.length > 0 && amounts.length !== tiers.length) {
        return { kind: 'dynamic' }
      }
      if (amounts.length === 0) {
        values.push('—')
        variable.push(false)
        continue
      }
      const min = Math.min(...amounts)
      const max = Math.max(...amounts)
      const minimum = formatDynamicUnitPrice(min, options)
      values.push(minimum)
      variable.push(min !== max)
    }
    return {
      kind: 'token',
      values,
      variable,
    }
  }
  if (isUnconfiguredTaskUsageModel(model)) return { kind: 'dynamic' }
  if (
    !Number.isFinite(
      model.quota_type === QUOTA_TYPE_VALUES.REQUEST
        ? model.model_price
        : model.model_ratio
    )
  ) {
    return { kind: 'dynamic' }
  }
  if (model.quota_type === QUOTA_TYPE_VALUES.REQUEST) {
    return {
      kind: 'request',
      price: formatFixedPrice(
        model,
        group,
        false,
        prices.priceRate,
        prices.usdExchangeRate,
        prices.groupRatio
      ),
    }
  }
  return {
    kind: 'token',
    values: (['input', 'output', 'cache'] as const).map((type) => {
      if (type === 'cache' && model.cache_ratio == null) return '—'
      return formatGroupPrice(
        model,
        group,
        type,
        'M',
        false,
        prices.priceRate,
        prices.usdExchangeRate,
        prices.groupRatio
      )
    }),
    variable: [false, false, false],
  }
}
