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
import { useMemo } from 'react'
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Switch } from '@/components/ui/switch'
import { getGroups } from '@/features/users/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import type { RequestChecksFormValues } from './request-checks-form'
import { ReviewNumberField } from './review-number-field'

// Options that choose which accounts are reviewed before the request goes
// upstream. They only apply in enforce mode.
export function ContentReviewSyncFields() {
  const { t } = useTranslation()
  const form = useFormContext<RequestChecksFormValues>()
  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
  })
  const groupOptions = useMemo(
    () =>
      (groups.data?.data ?? []).map((group) => ({
        value: group,
        label: group,
      })),
    [groups.data]
  )

  return (
    <SettingsFormGrid>
      <FormField
        control={form.control}
        name='content_safety_setting.sync_all'
        render={({ field }) => (
          <SettingsSwitchItem>
            <SettingsSwitchContent>
              <FormLabel>{t('Review every account first')}</FormLabel>
              <FormDescription>
                {t(
                  'Every account is reviewed before its request goes upstream, not in the background.'
                )}
              </FormDescription>
            </SettingsSwitchContent>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </SettingsSwitchItem>
        )}
      />
      <ReviewNumberField
        name='sync_new_user_days'
        label={t('New account period (days)')}
        description={t(
          'Accounts younger than this are reviewed before the request goes upstream. Set to 0 to turn it off.'
        )}
      />
      <FormField
        control={form.control}
        name='content_safety_setting.sync_groups'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Groups reviewed first')}</FormLabel>
            <FormControl>
              <MultiSelect
                options={groupOptions}
                selected={field.value.split('\n').filter(Boolean)}
                onChange={(values) => field.onChange(values.join('\n'))}
                placeholder={t('Select groups')}
                emptyText={t('No group found.')}
              />
            </FormControl>
            <FormDescription>
              {t(
                "Accounts in these groups are reviewed before the request goes upstream. This is the account's own group, not the token's group."
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </SettingsFormGrid>
  )
}
