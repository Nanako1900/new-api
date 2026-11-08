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
import { useQuery } from '@tanstack/react-query'
import { useFormContext, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Combobox } from '@/components/ui/combobox'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getEnabledModels } from '@/features/channels/api'
import { getGroups } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsControlChildren,
  SettingsControlGroup,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { safeNumberFieldProps } from '../utils/numeric-field'
import {
  CONTENT_SAFETY_INT_LIMITS,
  type ContentSafetyIntField,
  type RequestChecksFormValues,
} from './request-checks-form'

type ReviewNumberField = {
  name: Exclude<ContentSafetyIntField, 'log_retention_days'>
  label: string
  description: string
}

export function ContentReviewFields() {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const reviewEnabled = useWatch({
    control: form.control,
    name: 'content_safety_setting.review_enabled',
  })
  const { errors } = useFormState({
    control: form.control,
    name: 'content_safety_setting',
  })
  // Log retention is shown outside this group. Any other invalid option keeps
  // the group open, so a value typed before switching AI review off cannot
  // block saving without a visible message.
  const hasOptionError = Object.keys(errors.content_safety_setting ?? {}).some(
    (key) => key !== 'log_retention_days'
  )

  return (
    <SettingsControlGroup>
      <FormField
        control={form.control}
        name='content_safety_setting.review_enabled'
        render={({ field }) => (
          <SettingsSwitchItem>
            <SettingsSwitchContent>
              <FormLabel>{t('Enable AI review')}</FormLabel>
              <FormDescription>
                {t(
                  'Requests that contain a review word wait for the review model and are forwarded only after it confirms the content is safe. Requires filtering and prompt inspection.'
                )}
              </FormDescription>
            </SettingsSwitchContent>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </SettingsSwitchItem>
        )}
      />
      {(reviewEnabled || hasOptionError) && (
        <SettingsControlChildren
          role='group'
          aria-label={t('AI review options')}
          className='space-y-4'
        >
          <ReviewOptionFields />
        </SettingsControlChildren>
      )}
    </SettingsControlGroup>
  )
}

function ReviewOptionFields() {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const models = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => requireServerSuccess(await getEnabledModels()),
  })
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const modelOptions = (models.data?.data ?? []).map((model) => ({
    value: model,
    label: model,
  }))
  const groupOptions = (groups.data?.data ?? []).map((group) => ({
    value: group,
    label: group,
  }))
  const numberFields: ReviewNumberField[] = [
    {
      name: 'review_timeout_seconds',
      label: t('Review timeout (seconds)'),
      description: t('Includes waiting for a free review slot (1-60).'),
    },
    {
      name: 'review_max_concurrency',
      label: t('Maximum concurrent reviews'),
      description: t(
        'Reviews running at the same time on each server node (1-256).'
      ),
    },
    {
      name: 'review_rate_limit_per_minute',
      label: t('Reviews per user per minute'),
      description: t('Cached verdicts do not count (1-10000).'),
    },
    {
      name: 'window_chars',
      label: t('Context characters'),
      description: t(
        'Characters reviewed before and after each match (50-2000).'
      ),
    },
    {
      name: 'max_windows',
      label: t('Maximum review windows'),
      description: t(
        'Requests with more text windows to review are rejected (1-100).'
      ),
    },
    {
      name: 'cache_ttl_seconds',
      label: t('Verdict cache lifetime (seconds)'),
      description: t('Set to 0 to disable the cache (0-604800).'),
    },
  ]

  return (
    <>
      <Alert>
        <AlertDescription>
          {t(
            'AI review fails closed: if the review times out, no review channel is available, or the answer cannot be read, the request is rejected with HTTP 503.'
          )}
        </AlertDescription>
      </Alert>
      <Alert>
        <AlertDescription>
          {t(
            'Request content can try to manipulate the review model through prompt injection. Choose a model that is robust against it.'
          )}
        </AlertDescription>
      </Alert>
      <SettingsFormGrid>
        <FormField
          control={form.control}
          name='content_safety_setting.review_model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review model')}</FormLabel>
              <FormControl>
                <Combobox
                  options={modelOptions}
                  allowCustomValue
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? '')}
                  aria-label={t('Review model')}
                  placeholder={t('Select or enter a model')}
                  emptyText={t('No models found')}
                  className='w-full'
                />
              </FormControl>
              <FormDescription>
                {t('Must be served by a channel in the review group.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='content_safety_setting.review_group'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review group')}</FormLabel>
              <FormControl>
                <Combobox
                  options={groupOptions}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value ?? '')}
                  aria-label={t('Review group')}
                  placeholder={t('Select a group')}
                  emptyText={t('No group found.')}
                  className='w-full'
                />
              </FormControl>
              <FormDescription>
                {t('Channels in this group serve the review requests.')}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='content_safety_setting.review_words'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review words')}</FormLabel>
              <FormControl>
                <Textarea
                  rows={6}
                  placeholder={t('Enter one keyword per line')}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t(
                  'One word per line, case-insensitive. The text around each match is sent to the review model.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='content_safety_setting.review_prompt'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review prompt')}</FormLabel>
              <FormControl>
                <Textarea
                  rows={6}
                  placeholder={t('Built-in prompt')}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {t(
                  'Leave empty to use the built-in prompt. The required answer format is always appended.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {numberFields.map((item) => (
          <FormField
            key={item.name}
            control={form.control}
            name={`content_safety_setting.${item.name}` as const}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{item.label}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={CONTENT_SAFETY_INT_LIMITS[item.name].min}
                    max={CONTENT_SAFETY_INT_LIMITS[item.name].max}
                    step={1}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>{item.description}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </SettingsFormGrid>
    </>
  )
}
