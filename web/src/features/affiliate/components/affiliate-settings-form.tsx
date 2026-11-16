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
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { searchUsers } from '@/features/users/api'
import { useDebounce } from '@/hooks/use-debounce'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  affiliateSettingsSchema,
  type AffiliateSettingsValues,
} from '../lib/form'
import type { AffiliateAction, AffiliateSummary } from '../types'

export function AffiliateSettingsForm(props: {
  summary: AffiliateSummary
  onSubmit: (action: AffiliateAction) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [selectedInviter, setSelectedInviter] = useState<{
    value: string
    label: string
  } | null>(null)
  const keyword = useDebounce(search, 250)
  const query = useQuery({
    queryKey: ['affiliate-user-search', keyword],
    queryFn: async () =>
      requireServerSuccess(await searchUsers({ keyword, page_size: 20 })).data,
    enabled: keyword.trim().length > 0,
  })
  const form = useForm<AffiliateSettingsValues>({
    resolver: zodResolver(affiliateSettingsSchema),
    defaultValues: {
      inviter_id: props.summary.inviter_id,
      rate_percent: String(props.summary.rate_bps / 100),
    },
  })
  const candidates = query.data?.items ?? []
  const options = [{ value: '0', label: t('No inviter') }]
  if (props.summary.inviter_id > 0) {
    options.push({
      value: String(props.summary.inviter_id),
      label: `${props.summary.inviter_name || t('Inviter')} (#${props.summary.inviter_id})`,
    })
  }
  if (
    selectedInviter &&
    !options.some((option) => option.value === selectedInviter.value)
  ) {
    options.push(selectedInviter)
  }
  for (const candidate of candidates) {
    if (
      candidate.id === props.summary.user_id ||
      options.some((option) => option.value === String(candidate.id))
    ) {
      continue
    }
    options.push({
      value: String(candidate.id),
      label: `${candidate.display_name || candidate.username} (#${candidate.id})`,
    })
  }
  return (
    <Form {...form}>
      <form
        className='space-y-4'
        onSubmit={form.handleSubmit((values) =>
          props.onSubmit({
            user_id: props.summary.user_id,
            action: 'settings',
            inviter_id: values.inviter_id,
            rate_bps: Math.round(Number(values.rate_percent) * 100),
          })
        )}
      >
        <div className='space-y-2'>
          <Label htmlFor='affiliate-search'>
            {t('Search inviter by ID or username')}
          </Label>
          <Input
            id='affiliate-search'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={props.disabled}
          />
          {query.isFetching && (
            <p role='status' className='text-muted-foreground text-xs'>
              {t('Loading...')}
            </p>
          )}
          {query.isError && (
            <p role='alert' className='text-destructive text-xs'>
              {t('Failed to search users')}
            </p>
          )}
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <FormField
            control={form.control}
            name='inviter_id'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Inviter')}</FormLabel>
                <FormControl>
                  <Combobox
                    options={options}
                    value={String(field.value)}
                    onValueChange={(value) => {
                      setSelectedInviter(
                        options.find((option) => option.value === value) ?? null
                      )
                      field.onChange(Number(value ?? 0))
                    }}
                    disabled={props.disabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='rate_percent'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Cashback rate (%)')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    inputMode='decimal'
                    disabled={props.disabled}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className='text-muted-foreground text-xs'>
          {t(
            'This rate applies when this user’s invitees recharge. Changes apply to new orders only; no historical rewards are added.'
          )}
        </p>
        <Button type='submit' disabled={props.disabled}>
          {t('Save referral settings')}
        </Button>
      </form>
    </Form>
  )
}
