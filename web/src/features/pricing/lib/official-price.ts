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

/** How prices are being displayed: standard, or at the recharge rate. */
export type RechargeDisplay = {
  showRechargePrice: boolean
  priceRate: number
  usdExchangeRate: number
}

/** A channel's displayed price relative to the official price. */
export type OfficialPriceComparison =
  | { kind: 'free' }
  | { kind: 'discount'; factor: number }
  | { kind: 'same' }
  | { kind: 'markup'; factor: number }

// Badges show factors to two decimals; anything that would read "1×" is the
// official price.
const SAME_PRICE_TOLERANCE = 0.005

/**
 * Displayed price ÷ official price. The official price is the base price at
 * group ratio 1, so this is the channel's group ratio, times the recharge rate
 * when recharge prices are shown (see `applyRechargeRate` in `price.ts`).
 */
export function officialPriceFactor(
  groupRatio: number,
  display: RechargeDisplay
): number {
  if (!display.showRechargePrice) return groupRatio
  if (!(display.usdExchangeRate > 0) || !Number.isFinite(display.priceRate)) {
    return groupRatio
  }
  return (groupRatio * display.priceRate) / display.usdExchangeRate
}

/** Classify a factor from `officialPriceFactor`; invalid factors read as equal. */
export function compareWithOfficialPrice(
  factor: number
): OfficialPriceComparison {
  if (!Number.isFinite(factor) || factor < 0) return { kind: 'same' }
  if (factor === 0) return { kind: 'free' }
  if (Math.abs(factor - 1) < SAME_PRICE_TOLERANCE) return { kind: 'same' }
  if (factor < 1) return { kind: 'discount', factor }
  return { kind: 'markup', factor }
}
