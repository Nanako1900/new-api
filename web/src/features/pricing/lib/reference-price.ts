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
import type { CurrencyConfig } from '@/stores/system-config-store'

import type { PricingModel, PricingReference } from '../types'
import { parseTiersFromExpr } from './billing-expr'
import { flattenBinary } from './billing-expression/display'
import { compileBillingExpression } from './billing-expression/parser'
import type { ExpressionNode } from './billing-expression/types'

export type ReferencePriceComparison = {
  factor: number
  priceCount: number
  uniform: boolean
}

export type GroupReferencePriceComparison = ReferencePriceComparison & {
  comparableModels: number
  totalModels: number
}

/** A conservative comparison across the models actually available in one group. */
export function getGroupReferencePriceComparison(
  models: PricingModel[],
  group: string,
  groupRatio: number,
  reference: PricingReference | undefined,
  currency: CurrencyConfig
): GroupReferencePriceComparison | null {
  const available = models.filter((model) =>
    model.enable_groups?.some((name) => name === group || name === 'all')
  )
  const comparisons = available.flatMap((model) => {
    const comparison = getReferencePriceComparison(
      model,
      groupRatio,
      reference,
      currency
    )
    return comparison ? [comparison] : []
  })
  if (!comparisons.length) return null
  const factor = Math.max(...comparisons.map((entry) => entry.factor))
  return {
    factor,
    uniform: comparisons.every(
      (entry) => entry.uniform && Math.abs(entry.factor - factor) < 1e-9
    ),
    priceCount: comparisons.reduce((sum, entry) => sum + entry.priceCount, 0),
    comparableModels: comparisons.length,
    totalModels: available.length,
  }
}

/** Preserve the billing quantities, conditions, order and units; ignore only
 * tier names and unit-price coefficients. This also distinguishes p from
 * max(len - ai, 0), which the display parser labels with the same price field. */
function pricingSemantics(node: ExpressionNode): string | null {
  if (node.kind === 'conditional') {
    const yes = pricingSemantics(node.yes)
    const no = pricingSemantics(node.no)
    if (!yes || !no) return null
    return JSON.stringify([expressionSemantics(node.condition), yes, no])
  }
  if (node.kind === 'binary' && node.operator === '*') {
    for (const [quantity, pricing] of [
      [node.left, node.right],
      [node.right, node.left],
    ]) {
      if (quantity.kind === 'variable' && quantity.name === 'image_count') {
        const semantics = pricingSemantics(pricing)
        return semantics ? JSON.stringify(['image_count', semantics]) : null
      }
    }
    return null
  }
  if (node.kind !== 'call' || node.name !== 'tier') return null
  const body = node.args[1]
  if (body.kind === 'call' && body.name === 'fixed') return 'request'
  const quantities: string[] = []
  for (const term of flattenBinary(body, '+')) {
    if (term.kind !== 'binary' || term.operator !== '*') return null
    // The display parser already validates the coefficient and tier shape.
    const quantity =
      term.left.kind === 'literal' || term.left.kind === 'unary'
        ? term.right
        : term.left
    quantities.push(expressionSemantics(quantity))
  }
  return JSON.stringify(quantities.sort())
}

function expressionSemantics(node: ExpressionNode): string {
  return JSON.stringify(node, (key, value: unknown) =>
    key === 'start' || key === 'end' || key === 'integer' ? undefined : value
  )
}

/** Compare complete, self-contained expressions, never unrelated tier minima
 * or legacy ratio fields with provider-specific implicit pricing rules. */
export function getReferencePriceComparison(
  model: PricingModel,
  groupRatio: number,
  reference: PricingReference | undefined,
  currency: CurrencyConfig
): ReferencePriceComparison | null {
  const referenceModel = reference?.models[model.model_name]
  if (
    !reference ||
    !referenceModel ||
    reference.currency !== 'USD' ||
    model.billing_mode !== 'tiered_expr' ||
    !model.billing_expr ||
    referenceModel.billing_mode !== 'tiered_expr' ||
    model.billing_plugin_variants?.length ||
    Object.keys(model.billing_usage_schema ?? {}).length > 0 ||
    !Number.isFinite(groupRatio) ||
    groupRatio < 0 ||
    !Number.isFinite(reference.usd_to_cny_rate) ||
    reference.usd_to_cny_rate <= 0
  ) {
    return null
  }

  let siteRate = 1
  let referenceRate = 1
  if (currency.quotaDisplayType === 'CNY') {
    siteRate = currency.usdExchangeRate
    referenceRate = reference.usd_to_cny_rate
    if (!Number.isFinite(siteRate) || siteRate <= 0) return null
  } else if (currency.quotaDisplayType !== 'USD') {
    return null
  }

  const site = compileBillingExpression(model.billing_expr)
  const benchmark = compileBillingExpression(referenceModel.billing_expr)
  if (
    site.status !== 'ready' ||
    benchmark.status !== 'ready' ||
    site.requestRules.length > 0 ||
    benchmark.requestRules.length > 0
  ) {
    return null
  }
  const siteTiers = parseTiersFromExpr(model.billing_expr)
  const referenceTiers = parseTiersFromExpr(referenceModel.billing_expr)
  if (!siteTiers.length || siteTiers.length !== referenceTiers.length) {
    return null
  }
  const semantics = pricingSemantics(site.ast)
  if (!semantics || semantics !== pricingSemantics(benchmark.ast)) return null

  let factor = 0
  let minimumFactor = Infinity
  let priceCount = 0
  for (const [index, tier] of siteTiers.entries()) {
    const referenceTier = referenceTiers[index]
    const fields = Object.keys(tier)
      .filter((key) => key.endsWith('Price'))
      .sort()
    const referenceFields = Object.keys(referenceTier)
      .filter((key) => key.endsWith('Price'))
      .sort()
    if (!fields.length || fields.join(',') !== referenceFields.join(',')) {
      return null
    }
    for (const field of fields) {
      const sitePrice = tier[field]
      const referencePrice = referenceTier[field]
      if (
        typeof sitePrice !== 'number' ||
        !Number.isFinite(sitePrice) ||
        sitePrice < 0 ||
        typeof referencePrice !== 'number' ||
        !Number.isFinite(referencePrice) ||
        referencePrice <= 0
      ) {
        return null
      }
      const siteAmount = sitePrice * groupRatio * siteRate
      const referenceAmount = referencePrice * referenceRate
      if (
        !Number.isFinite(siteAmount) ||
        !Number.isFinite(referenceAmount) ||
        referenceAmount <= 0
      ) {
        return null
      }
      const ratio = siteAmount / referenceAmount
      if (!Number.isFinite(ratio)) return null
      factor = Math.max(factor, ratio)
      minimumFactor = Math.min(minimumFactor, ratio)
      priceCount += 1
    }
  }
  return {
    factor,
    priceCount,
    uniform: Math.abs(factor - minimumFactor) < 1e-9,
  }
}
