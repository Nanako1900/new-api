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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'

import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  CONTENT_SAFETY_INT_LIMITS,
  type ContentSafetyIntField,
  type RequestChecksFormValues,
} from './request-checks-form'

type ReviewNumberFieldProps = {
  name: ContentSafetyIntField
  label: string
  description: string
}

export function ReviewNumberField(props: ReviewNumberFieldProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const form = useFormContext<RequestChecksFormValues>()
  const limits = CONTENT_SAFETY_INT_LIMITS[props.name]

  return (
    <FormField
      control={form.control}
      name={`content_safety_setting.${props.name}` as const}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            <Input
              type='number'
              min={limits.min}
              max={limits.max}
              step={1}
              {...safeNumberFieldProps(field)}
            />
          </FormControl>
          <FormDescription>
            {props.description}{' '}
            {t('Allowed range: {{min}}–{{max}}', {
              min: formatNumber(limits.min, locale),
              max: formatNumber(limits.max, locale),
            })}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
