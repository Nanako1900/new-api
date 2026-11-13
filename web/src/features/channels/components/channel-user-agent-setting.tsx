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
import { useFormContext, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { FieldGroup } from '@/components/ui/field'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { SettingsSwitchField } from '@/features/system-settings/components/settings-form-layout'

import type { ChannelFormValues } from '../lib/channel-form'

export function ChannelUserAgentSetting(props: { disabled?: boolean }) {
  const { t } = useTranslation()
  const form = useFormContext<ChannelFormValues>()
  const controlId = useId()
  const [enabled, profile] = useWatch({
    control: form.control,
    name: ['user_agent_restriction_enabled', 'user_agent_profile'],
  })

  return (
    <FieldGroup>
      <SettingsSwitchField
        controlId={controlId}
        checked={enabled === true}
        disabled={props.disabled}
        onCheckedChange={(value) =>
          form.setValue('user_agent_restriction_enabled', value, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
        label={t('Restrict client User-Agent')}
        description={t(
          'Reject requests whose User-Agent is not allowed. User-Agent can be spoofed and does not prove client identity.'
        )}
      />
      {enabled && (
        <>
          <FormField
            control={form.control}
            name='user_agent_profile'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Allowed client')}</FormLabel>
                <Select
                  value={field.value ?? 'claude_code'}
                  onValueChange={field.onChange}
                  disabled={props.disabled}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue>
                        {field.value === 'custom'
                          ? t('Custom User-Agent allowlist')
                          : 'Claude Code'}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value='claude_code'>Claude Code</SelectItem>
                      <SelectItem value='custom'>
                        {t('Custom User-Agent allowlist')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormDescription>
                  {t(
                    'A rejected request stops immediately without trying another channel. Use a separate group for dedicated clients.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          {profile === 'custom' && (
            <>
              <FormField
                control={form.control}
                name='user_agent_exact'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Exact User-Agent matches')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        disabled={props.disabled}
                        rows={3}
                      />
                    </FormControl>
                    <FormDescription>
                      {t(
                        'One value per line. Matching is case-sensitive; any exact match or prefix allows the request. Up to 20 rules, 1024 bytes each.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name='user_agent_prefixes'
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('Allowed User-Agent prefixes')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        value={field.value ?? ''}
                        disabled={props.disabled}
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </>
          )}
        </>
      )}
    </FieldGroup>
  )
}
