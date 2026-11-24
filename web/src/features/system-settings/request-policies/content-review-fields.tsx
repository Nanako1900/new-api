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
import { useId, useMemo } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'
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
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getEnabledModels } from '@/features/channels/api'
import { getGroups } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsControlChildren,
  SettingsControlGroup,
  SettingsFormGrid,
  SettingsFormGridItem,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { ContentReviewEscalationFields } from './content-review-escalation-fields'
import { ContentReviewSyncFields } from './content-review-sync-fields'
import type { ContentReviewEngine, ContentReviewMode } from './defaults'
import type { RequestChecksFormValues } from './request-checks-form'
import { ReviewNumberField } from './review-number-field'

type ContentReviewFieldsProps = {
  // True after a save was refused because of an invalid value; keeps the
  // options open while the value is corrected.
  revealed: boolean
}

const REVIEW_MODES: ContentReviewMode[] = ['off', 'shadow', 'enforce']
const REVIEW_ENGINES: ContentReviewEngine[] = ['llm_json', 'qwen3guard']

export function ContentReviewFields(props: ContentReviewFieldsProps) {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const reviewMode = useWatch({
    control: form.control,
    name: 'content_safety_setting.review_mode',
  })
  const open = reviewMode !== 'off' || props.revealed
  const noteId = useId()
  const modeLabels: Record<ContentReviewMode, string> = {
    off: t('Off'),
    shadow: t('Shadow'),
    enforce: t('Enforce'),
  }
  const modeDescriptions: Record<ContentReviewMode, string> = {
    off: t('No AI review.'),
    shadow: t(
      'Every new message is reviewed in the background. Nothing is blocked.'
    ),
    enforce: t(
      'Most accounts are reviewed in the background. Accounts that need it are reviewed before the request goes upstream.'
    ),
  }

  return (
    <SettingsControlGroup>
      <FormField
        control={form.control}
        name='content_safety_setting.review_mode'
        render={({ field }) => (
          <FormItem>
            <FormLabel id={`${noteId}-mode`}>{t('AI review mode')}</FormLabel>
            <FormControl>
              <RadioGroup
                aria-labelledby={`${noteId}-mode`}
                value={field.value}
                onValueChange={field.onChange}
                className='gap-2 sm:grid-cols-3'
              >
                {REVIEW_MODES.map((mode) => (
                  <div key={mode} className='rounded-lg border'>
                    <Label
                      htmlFor={`${noteId}-${mode}`}
                      className='hover:bg-muted/30 flex h-full cursor-pointer items-start gap-3 rounded-lg px-4 py-3 font-normal'
                    >
                      <RadioGroupItem
                        id={`${noteId}-${mode}`}
                        aria-labelledby={`${noteId}-${mode}-label`}
                        aria-describedby={`${noteId}-${mode}-description`}
                        value={mode}
                        onClick={() => field.onChange(mode)}
                        className='mt-0.5'
                      />
                      <span className='flex min-w-0 flex-col gap-1'>
                        <span id={`${noteId}-${mode}-label`}>
                          {modeLabels[mode]}
                        </span>
                        <span
                          id={`${noteId}-${mode}-description`}
                          className='text-muted-foreground text-xs font-normal'
                        >
                          {modeDescriptions[mode]}
                        </span>
                      </span>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {open && (
        <SettingsControlChildren
          role='group'
          aria-label={t('AI review options')}
          aria-describedby={noteId}
          className='space-y-4'
        >
          <ReviewOptionFields noteId={noteId} mode={reviewMode} />
        </SettingsControlChildren>
      )}
    </SettingsControlGroup>
  )
}

function ReviewOptionFields(props: {
  noteId: string
  mode: ContentReviewMode
}) {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const [toolResults, engine] = useWatch({
    control: form.control,
    name: [
      'content_safety_setting.review_tool_results',
      'content_safety_setting.review_engine',
    ],
  })
  // The classifier answers in its own format and ignores the review prompt.
  const promptUnused = engine === 'qwen3guard'
  const engineLabels: Record<ContentReviewEngine, string> = {
    llm_json: t('Chat model (JSON verdict)'),
    qwen3guard: t('Qwen3Guard classifier'),
  }
  const engineDescriptions: Record<ContentReviewEngine, string> = {
    llm_json: t(
      'A general chat model judges the text with the review prompt and answers in JSON.'
    ),
    qwen3guard: t(
      'A Qwen3Guard safety classifier served through an OpenAI-compatible channel.'
    ),
  }
  const models = useQuery({
    queryKey: ['enabled-models'],
    queryFn: async () => requireServerSuccess(await getEnabledModels()),
  })
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const modelOptions = useMemo(
    () =>
      (models.data?.data ?? []).map((model) => ({
        value: model,
        label: model,
      })),
    [models.data]
  )
  const groupOptions = useMemo(
    () =>
      (groups.data?.data ?? []).map((group) => ({
        value: group,
        label: group,
      })),
    [groups.data]
  )

  return (
    <>
      <p id={props.noteId} className='text-muted-foreground text-sm'>
        {t(
          'Synchronous reviews fail closed: if the review times out, no review channel is available, or the answer cannot be read, the request is rejected with HTTP 503. Request content can try to manipulate the review model through prompt injection, so choose a model that is robust against it.'
        )}{' '}
        {t(
          'Not covered: Realtime sessions (including their text events), images, files and audio content.'
        )}
      </p>
      <SettingsFormGrid>
        <SettingsFormGridItem span='full'>
          <FormField
            control={form.control}
            name='content_safety_setting.review_engine'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Review engine')}</FormLabel>
                <Select
                  items={REVIEW_ENGINES.map((value) => ({
                    value,
                    label: engineLabels[value],
                  }))}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    {/* As wide as one column of the grid below (gap-x-5). */}
                    <SelectTrigger className='w-full lg:w-[calc(50%-0.625rem)]'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {REVIEW_ENGINES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {engineLabels[value]}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {engineDescriptions[field.value]}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsFormGridItem>
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
                  ref={field.ref}
                  onBlur={field.onBlur}
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
                  ref={field.ref}
                  onBlur={field.onBlur}
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
          name='content_safety_setting.review_prompt'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review prompt')}</FormLabel>
              <FormControl>
                <Textarea
                  rows={6}
                  placeholder={t('Built-in prompt')}
                  {...field}
                  disabled={promptUnused}
                />
              </FormControl>
              <FormDescription>
                {promptUnused
                  ? t('Not used by the Qwen3Guard classifier.')
                  : t(
                      'Leave empty to use the built-in prompt. The required answer format is always appended.'
                    )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='content_safety_setting.review_tool_results'
          render={({ field }) => (
            <SettingsSwitchItem>
              <SettingsSwitchContent>
                <FormLabel>{t('Review tool results')}</FormLabel>
                <FormDescription>
                  {t(
                    'Also review text labelled as a tool result. Turning this off saves reviews.'
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
        {!toolResults && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t(
                'Clients write their own conversation history, so text labelled as a tool result can skip review. Only turn this off if you accept that.'
              )}
            </AlertDescription>
          </Alert>
        )}
        <ReviewNumberField
          name='review_timeout_seconds'
          label={t('Review timeout (seconds)')}
          description={t('Includes waiting for a free review slot.')}
        />
        <ReviewNumberField
          name='review_max_concurrency'
          label={t('Synchronous review slots')}
          description={t(
            'Synchronous reviews running at the same time on each server node.'
          )}
        />
        <ReviewNumberField
          name='review_rate_limit_per_minute'
          label={t('Synchronous reviews per account per minute')}
          description={t(
            'Each new piece reviewed counts; cached verdicts do not.'
          )}
        />
        <ReviewNumberField
          name='unit_chars'
          label={t('Characters per reviewed piece')}
          description={t('The longest text reviewed as one piece.')}
        />
        <ReviewNumberField
          name='max_units'
          label={t('Maximum pieces per request')}
          description={t(
            "Most new pieces reviewed per request. A synchronous review with more is rejected; a background review reviews the newest and marks the rest truncated, and when enforced the account's next requests are reviewed before going upstream for 10 minutes."
          )}
        />
        <ReviewNumberField
          name='async_workers'
          label={t('Background review workers')}
          description={t('Restart required.')}
        />
        <ReviewNumberField
          name='async_queue_size'
          label={t('Background review queue size')}
          description={t('Restart required.')}
        />
        <ReviewNumberField
          name='async_rate_per_minute'
          label={t('Background reviews per account per minute')}
          description={t(
            "Each new piece queued counts. Over this, the account's next requests are reviewed before going upstream for 10 minutes."
          )}
        />
        <ReviewNumberField
          name='pass_log_percent'
          label={t('Passed reviews logged (%)')}
          description={t('Share of passed reviews written to the log.')}
        />
        <ReviewNumberField
          name='cache_ttl_seconds'
          label={t('Verdict cache lifetime (seconds)')}
          description={t('Set to 0 to disable the cache.')}
        />
      </SettingsFormGrid>
      <ContentReviewEscalationFields
        modelOptions={modelOptions}
        groupOptions={groupOptions}
      />
      {props.mode === 'enforce' && <ContentReviewSyncFields />}
    </>
  )
}
