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
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

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
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { handleServerError } from '@/lib/handle-server-error'

import {
  SettingsForm,
  SettingsControlGroup,
  SettingsControlChildren,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useResetForm } from '../hooks/use-reset-form'
import { safeNumberFieldProps } from '../utils/numeric-field'
import { ContentReviewFields } from './content-review-fields'
import {
  CONTENT_SAFETY_INT_LIMITS,
  CONTENT_SAFETY_OPTION_PREFIX,
  REVIEW_GUARD_OPTION_KEYS,
  createRequestChecksSchema,
  requestChecksFormValues,
  requestChecksOptions,
  type RequestChecksFormValues,
  type RequestChecksSettings,
} from './request-checks-form'
import { useSavePolicy } from './use-save-policy'

type RequestChecksSectionProps = {
  defaultValues: RequestChecksSettings
}

function PromptFilteringStatus(props: {
  control: Control<RequestChecksFormValues>
}) {
  const { t } = useTranslation()
  const values = useWatch({ control: props.control })
  const active =
    !!values.CheckSensitiveEnabled &&
    !!values.CheckSensitiveOnPromptEnabled &&
    ((values.SensitiveWords ?? '').trim() !== '' ||
      !!values.content_safety_setting?.review_enabled)
  return (
    <Alert>
      <AlertDescription>
        {active
          ? t('Prompt text filtering is active with the current form values.')
          : t(
              'Prompt text filtering needs both switches enabled and a non-empty block word list or AI review.'
            )}
      </AlertDescription>
    </Alert>
  )
}

export function RequestChecksSection(props: RequestChecksSectionProps) {
  const { t } = useTranslation()
  const updateOption = useSavePolicy()
  const schema = useMemo(() => createRequestChecksSchema(t), [t])
  const formDefaults = useMemo(
    () => requestChecksFormValues(props.defaultValues),
    [props.defaultValues]
  )
  const form = useForm<RequestChecksFormValues>({
    resolver: zodResolver(schema),
    defaultValues: formDefaults,
  })
  // Refreshing another policy passes equal values again; only a real change
  // of the saved values resets unsaved edits.
  useResetForm(form, formDefaults)
  // An invalid save opens the AI review options even while review is off, so
  // the error is visible. They stay open until the saved values change or a
  // save succeeds, which keeps the field being corrected from disappearing.
  const [optionsRevealed, setOptionsRevealed] = useState(false)
  useEffect(() => {
    setOptionsRevealed(false)
  }, [formDefaults])

  const onInvalid = () => setOptionsRevealed(true)

  const onSubmit = async (values: RequestChecksFormValues) => {
    const saved = requestChecksOptions(formDefaults)
    const current = requestChecksOptions(values)
    const updates = Object.fromEntries(
      Object.entries(current).filter(([key, value]) => value !== saved[key])
    )
    if (Object.keys(updates).length === 0) return
    // The backend checks that the review group exists only when a write
    // contains these two keys, so every content safety save carries them.
    if (
      Object.keys(updates).some((key) =>
        key.startsWith(CONTENT_SAFETY_OPTION_PREFIX)
      )
    ) {
      for (const key of REVIEW_GUARD_OPTION_KEYS) updates[key] = current[key]
    }
    try {
      await updateOption.mutateAsync(updates)
      setOptionsRevealed(false)
    } catch (error) {
      handleServerError(error)
    }
  }

  return (
    <SettingsSection title={t('Request checks')}>
      <p className='text-muted-foreground text-sm'>
        {t('Source: global settings. Changes take effect after saving.')}
      </p>
      <h3 className='text-sm font-medium'>{t('Request text filtering')}</h3>
      <p className='text-muted-foreground text-sm'>
        {t(
          'Checks text extracted from supported requests against keywords, ignoring case. A match rejects the request before upstream processing and does not affect channel health. Images, audio and generated responses are not checked.'
        )}
      </p>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit, onInvalid)}
            isSaving={form.formState.isSubmitting}
            saveLabel='Save Changes'
          />
          <PromptFilteringStatus control={form.control} />
          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='CheckSensitiveEnabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Enable filtering')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Blocks messages when sensitive keywords are detected.'
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

            <SettingsControlChildren>
              <FormField
                control={form.control}
                name='CheckSensitiveOnPromptEnabled'
                render={({ field }) => (
                  <SettingsSwitchItem>
                    <SettingsSwitchContent>
                      <FormLabel>{t('Inspect user prompts')}</FormLabel>
                      <FormDescription>
                        {t(
                          'When enabled, prompts are scanned before reaching upstream models.'
                        )}
                      </FormDescription>
                    </SettingsSwitchContent>
                    <FormControl>
                      <Switch
                        disabled={!form.watch('CheckSensitiveEnabled')}
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </SettingsSwitchItem>
                )}
              />
            </SettingsControlChildren>
          </SettingsControlGroup>

          <FormField
            control={form.control}
            name='SensitiveWords'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Block words')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={12}
                    placeholder={t('Enter one keyword per line')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Each line represents one keyword. Leave blank to disable the list but keep the switch states.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <ContentReviewFields revealed={optionsRevealed} />

          <FormField
            control={form.control}
            name='content_safety_setting.log_retention_days'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('Content safety log retention (days)')}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    min={CONTENT_SAFETY_INT_LIMITS.log_retention_days.min}
                    max={CONTENT_SAFETY_INT_LIMITS.log_retention_days.max}
                    step={1}
                    {...safeNumberFieldProps(field)}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Block and review records older than this are deleted once a day.'
                  )}{' '}
                  {t(
                    'Allowed range: {{min}}–{{max}}',
                    CONTENT_SAFETY_INT_LIMITS.log_retention_days
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>
    </SettingsSection>
  )
}
