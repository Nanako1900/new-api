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
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import { compareWithOfficialPrice } from '../../lib/official-price'

const SAVING_BADGE = 'bg-success/10 text-success'

export interface MeowOfficialPriceBadgeProps {
  /** Displayed price ÷ official price, from `officialPriceFactor`. */
  factor: number
  /** Label a family's lowest channel price; only savings are shown. */
  best?: boolean
  className?: string
}

/** How a price compares with the official price: "70% off", "1.5×" and so on. */
export function MeowOfficialPriceBadge(props: MeowOfficialPriceBadgeProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const comparison = compareWithOfficialPrice(props.factor)

  if (comparison.kind === 'discount') {
    // Chinese reads discounts as 折 (tenths paid), other languages as percent
    // off: every translation receives both and uses `{{zhe}}` or `{{off}}`.
    const values = {
      zhe: formatNumber(comparison.factor * 10, locale),
      off: formatNumber((1 - comparison.factor) * 100, locale),
    }
    return (
      <Badge className={cn(SAVING_BADGE, props.className)}>
        {props.best
          ? t('Up to {{off}}% off official price', values)
          : t('{{off}}% off official price', values)}
      </Badge>
    )
  }
  if (comparison.kind === 'free') {
    return (
      <Badge className={cn(SAVING_BADGE, props.className)}>
        {t('Free of charge')}
      </Badge>
    )
  }
  if (props.best) return null
  if (comparison.kind === 'markup') {
    return (
      <Badge variant='secondary' className={props.className}>
        {t('{{factor}}× official price', {
          factor: formatNumber(comparison.factor, locale),
        })}
      </Badge>
    )
  }
  return (
    <Badge variant='outline' className={props.className}>
      {t('Same as official price')}
    </Badge>
  )
}
