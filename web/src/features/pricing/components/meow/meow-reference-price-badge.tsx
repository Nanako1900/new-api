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

import type { ReferencePriceComparison } from '../../lib/reference-price'

export function MeowReferencePriceBadge(props: {
  comparison: ReferencePriceComparison | null
}) {
  const { t, i18n } = useTranslation()
  const comparison = props.comparison
  if (!comparison || comparison.factor >= 1) return null
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  let off = (1 - comparison.factor) * 100
  let zhe = comparison.factor * 10
  if (!comparison.uniform) {
    off = Math.floor(off * 100) / 100
    zhe = Math.ceil(zhe * 100) / 100
  }
  const values = {
    off: formatNumber(off, locale),
    zhe: formatNumber(zhe, locale),
  }
  return (
    <Badge className='bg-success/10 text-success mt-1 h-auto min-h-5 max-w-full whitespace-normal'>
      {comparison.uniform
        ? t('About {{off}}% below reference', values)
        : t('At least {{off}}% below reference', values)}
    </Badge>
  )
}
