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
import {
  defaultCCSwitchModels,
  GPT_MODEL,
  newestModel,
} from '@/features/keys/lib/cc-switch-defaults'
import {
  DEFAULT_TOKEN_UNIT,
  QUOTA_TYPE_VALUES,
} from '@/features/pricing/constants'
import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
  isDynamicPricingModel,
} from '@/features/pricing/lib/dynamic-price'
import { formatPrice } from '@/features/pricing/lib/price'
import type { PricingModel } from '@/features/pricing/types'

/** The two columns of the overview's model card. */
export type ModelFamily = 'claude' | 'gpt'

const FAMILY_NAME: Record<ModelFamily, RegExp> = {
  claude: /^claude-/,
  gpt: GPT_MODEL,
}

/**
 * The models of a family the overview features: the most used this week
 * first (`rankedNames` is the site-wide ranking), then the models CC Switch
 * fills in by default. Only models the site sells are shown.
 */
export function popularModels(
  family: ModelFamily,
  rankedNames: readonly string[],
  available: readonly string[],
  count = 2
): string[] {
  const sold = new Set(available)
  const picked: string[] = []
  const add = (name: string) => {
    if (picked.length >= count || !name || picked.includes(name)) return
    if (sold.has(name) && FAMILY_NAME[family].test(name)) picked.push(name)
  }

  rankedNames.forEach(add)
  if (family === 'claude') {
    const defaults = defaultCCSwitchModels('claude', available)
    add(defaults.opusModel)
    add(defaults.sonnetModel)
    add(defaults.haikuModel)
  } else {
    add(defaultCCSwitchModels('codex', available).model)
    add(
      newestModel(
        available.filter((name) => !picked.includes(name)),
        GPT_MODEL
      )
    )
  }
  return picked
}

/** A model's input and output price per 1M tokens, with currency. */
export type TokenPriceSummary = {
  input: string
  output: string
  /** The price changes with the request (context length tiers). */
  tiered: boolean
}

/**
 * The input and output price per 1M tokens the overview shows, computed
 * the way the pricing page computes them. For a tiered billing expression
 * these are the first tier's prices. Null when the model is not priced per
 * token (per request, task usage or a special expression).
 */
export function tokenPriceSummary(
  model: PricingModel,
  rates: { priceRate: number; usdExchangeRate: number }
): TokenPriceSummary | null {
  if (isDynamicPricingModel(model)) {
    const summary = getDynamicPricingSummary(model, {
      tokenUnit: DEFAULT_TOKEN_UNIT,
      priceRate: rates.priceRate,
      usdExchangeRate: rates.usdExchangeRate,
      groupRatioMultiplier: getDynamicDisplayGroupRatio(model),
    })
    const entries = summary?.primaryEntries ?? []
    const input = entries.find((entry) => entry.field === 'inputPrice')
    const output = entries.find((entry) => entry.field === 'outputPrice')
    if (!summary || !input || !output) return null
    return {
      input: input.formatted,
      output: output.formatted,
      tiered: summary.tierCount > 1,
    }
  }
  if (model.quota_type !== QUOTA_TYPE_VALUES.TOKEN) return null
  return {
    input: formatPrice(
      model,
      'input',
      DEFAULT_TOKEN_UNIT,
      false,
      rates.priceRate,
      rates.usdExchangeRate
    ),
    output: formatPrice(
      model,
      'output',
      DEFAULT_TOKEN_UNIT,
      false,
      rates.priceRate,
      rates.usdExchangeRate
    ),
    tiered: false,
  }
}

// The ratio the gateway reports for a model nobody set a price for.
const UNSET_MODEL_RATIO = 37.5

/**
 * Whether a model has no real price yet: it runs on the gateway's fallback
 * ratio, or its billing expression multiplies every quantity by zero (the
 * placeholder `p * 0 + c * 0`). A price deliberately set to that ratio, or a
 * model meant to be free, reads as unpriced too. Per-request prices never do.
 */
export function isUnpricedModel(model: PricingModel): boolean {
  if (isDynamicPricingModel(model)) {
    const factors = [...(model.billing_expr ?? '').matchAll(/\*\s*([\d.]+)/g)]
    return (
      factors.length > 0 && factors.every((match) => Number(match[1]) === 0)
    )
  }
  if (model.quota_type !== QUOTA_TYPE_VALUES.TOKEN) return false
  return model.model_ratio === UNSET_MODEL_RATIO
}
