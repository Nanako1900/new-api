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
import { useId } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import type { ComboboxInputOption } from '@/components/ui/combobox-input'
import { FieldDescription, FieldLegend, FieldSet } from '@/components/ui/field'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

import { SettingsFormGrid } from '../components/settings-form-layout'
import type { RequestChecksFormValues } from './request-checks-form'

type ContentReviewEscalationFieldsProps = {
  modelOptions: readonly ComboboxInputOption[]
  groupOptions: readonly ComboboxInputOption[]
}

// A second review of the verdicts the first review could not settle.
export function ContentReviewEscalationFields(
  props: ContentReviewEscalationFieldsProps
) {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const descriptionId = useId()

  return (
    <FieldSet aria-describedby={descriptionId}>
      <FieldLegend variant='label'>{t('Escalation')}</FieldLegend>
      <FieldDescription id={descriptionId}>
        {t(
          'A controversial verdict, or a review the channel refused, is reviewed again by the escalation model with the review prompt, and its verdict replaces the first one. Leave the model empty to turn escalation off.'
        )}
      </FieldDescription>
      <SettingsFormGrid>
        <FormField
          control={form.control}
          name='content_safety_setting.escalate_model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Escalation model')}</FormLabel>
              <FormControl>
                <Combobox
                  options={props.modelOptions}
                  allowCustomValue
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? '')}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-label={t('Escalation model')}
                  placeholder={t('Select or enter a model')}
                  emptyText={t('No models found')}
                  className='w-full'
                />
              </FormControl>
              <FormDescription>
                {t(
                  'A general chat model, served by a channel in the escalation group.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='content_safety_setting.escalate_group'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Escalation group')}</FormLabel>
              <FormControl>
                <Combobox
                  options={props.groupOptions}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? '')}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  aria-label={t('Escalation group')}
                  placeholder={t('Select a group')}
                  emptyText={t('No group found.')}
                  className='w-full'
                />
              </FormControl>
              <FormDescription>
                {t('Channels in this group serve the escalation requests.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </SettingsFormGrid>
    </FieldSet>
  )
}
