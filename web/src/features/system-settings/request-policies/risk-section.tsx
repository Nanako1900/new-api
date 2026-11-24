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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { toIntlLocale } from '@/i18n/languages'
import { handleServerError } from '@/lib/handle-server-error'

import {
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import type { ContentReviewMode, ContentRiskSettings } from './defaults'
import { ReviewNumberField } from './review-number-field'
import {
  RISK_CATEGORIES,
  RISK_CATEGORY_LABEL_KEYS,
  createRiskSchema,
  riskFormValues,
  riskOptions,
  type RiskFormValues,
} from './risk-form'
import { useSavePolicy } from './use-save-policy'

type RiskSectionProps = {
  defaultValues: ContentRiskSettings & {
    'content_safety_setting.review_mode': ContentReviewMode
  }
}

export function RiskSection(props: RiskSectionProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const updateOption = useSavePolicy()
  const schema = useMemo(() => createRiskSchema(t, locale), [t, locale])
  const formDefaults = useMemo(
    () => riskFormValues(props.defaultValues),
    [props.defaultValues]
  )
  const form = useForm<RiskFormValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  useResetForm(form, formDefaults)
  const categoryOptions = RISK_CATEGORIES.map((category) => ({
    value: category,
    label: t(RISK_CATEGORY_LABEL_KEYS[category]),
  }))
  // The saved mode decides whether the levels act; the mode itself is edited
  // in the request checks section.
  const modeStatus = {
    off: t('AI review is off, so no account is scored.'),
    shadow: t(
      'AI review is in shadow mode: a separate shadow score shows who would be blocked, and no account is restricted.'
    ),
    enforce: t('AI review is enforcing, so the risk levels take effect.'),
  }[props.defaultValues['content_safety_setting.review_mode']]

  const onSubmit = async (values: RiskFormValues) => {
    const saved = riskOptions(formDefaults)
    const updates = Object.fromEntries(
      Object.entries(riskOptions(values)).filter(
        ([key, value]) => value !== saved[key]
      )
    )
    if (Object.keys(updates).length === 0) return
    try {
      await updateOption.mutateAsync(updates)
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <SettingsSection title={t('Risk control')}>
      <p className='text-muted-foreground text-sm'>
        {t('Source: global settings. Changes take effect after saving.')}
      </p>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Every account has a risk score fed by AI review verdicts. The score decays over time. As it rises, the account is watched (its requests are reviewed before going upstream), then restricted (its requests are throttled), then blocked (every API request is rejected until an admin resets the score; the account can still sign in). Trusted accounts are never held back, and root accounts are never scored.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={form.formState.isSubmitting}
            saveLabel='Save Changes'
          />
          <Alert>
            <AlertDescription>
              <p>
                {t('Risk levels act only when the AI review mode is Enforce.')}
              </p>
              <p>{modeStatus}</p>
            </AlertDescription>
          </Alert>
          <SettingsFormGrid>
            <ReviewNumberField
              name='risk_half_life_hours'
              label={t('Score half-life (hours)')}
              description={t(
                'Without new verdicts, a score halves after this many hours.'
              )}
            />
            <ReviewNumberField
              name='risk_restrict_rpm'
              label={t('Requests per minute while restricted')}
              description={t(
                'The most API requests a restricted account can make per minute.'
              )}
            />
            <ReviewNumberField
              name='risk_points_unsafe'
              label={t('Points per unsafe verdict')}
              description={t('Added to the score for each unsafe verdict.')}
            />
            <ReviewNumberField
              name='risk_points_controversial'
              label={t('Points per controversial verdict')}
              description={t(
                'Added for each controversial verdict, including reviews the review channel refused.'
              )}
            />
            <ReviewNumberField
              name='risk_watch_threshold'
              label={t('Watch threshold')}
              description={t(
                "From this score, the account's requests are reviewed before going upstream."
              )}
            />
            <ReviewNumberField
              name='risk_restrict_threshold'
              label={t('Restrict threshold')}
              description={t(
                "From this score, the account's requests are throttled."
              )}
            />
            <ReviewNumberField
              name='risk_block_threshold'
              label={t('Block threshold')}
              description={t(
                'At this score, the account is blocked until an admin resets it.'
              )}
            />
          </SettingsFormGrid>
          <FormField
            control={form.control}
            name='content_safety_setting.risk_zero_tolerance_categories'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Zero-tolerance categories')}</FormLabel>
                <FormControl>
                  <MultiSelect
                    options={categoryOptions}
                    selected={field.value.split('\n').filter(Boolean)}
                    onChange={(values) => field.onChange(values.join('\n'))}
                    placeholder={t('Select categories')}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'One unsafe verdict in these categories blocks the account at once.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='content_safety_setting.risk_notify_enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Notify admins')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Notify admins when an account is restricted, blocked, or hits a zero-tolerance category.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
