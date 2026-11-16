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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Dialog } from '@/components/dialog'
import { ErrorState } from '@/components/error-state'
import { LoadingState } from '@/components/loading-state'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useUsers } from '@/features/users/components/users-provider'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyAmount } from '@/lib/currency'
import { handleServerError } from '@/lib/handle-server-error'

import { getAffiliate, manageAffiliate } from '../api'
import type { AffiliateAction } from '../types'
import { AffiliateHistory } from './affiliate-history'
import { AffiliateInvitees } from './affiliate-invitees'
import { AffiliateOverview } from './affiliate-overview'
import { AffiliateSettingsForm } from './affiliate-settings-form'

export function AffiliateAdminDialog(props: {
  userId: number
  username: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const client = useQueryClient()
  const { requestVerification, verificationActive } = useUsers()
  const [pending, setPending] = useState<AffiliateAction | null>(null)
  const [note, setNote] = useState('')
  const query = useQuery({
    queryKey: ['affiliate', props.userId],
    queryFn: () => getAffiliate(props.userId),
    enabled: props.open,
  })
  const mutation = useMutation({
    mutationFn: async (action: AffiliateAction) => {
      const proof = await requestVerification({
        scope: 'admin.user.affiliate',
        context: action,
        title: t('Verify referral operation'),
        description: t(
          'Confirm your identity before changing the account {{username}}.',
          { username: props.username }
        ),
      })
      if (!proof) return false
      await manageAffiliate(action, proof.proof_token)
      return true
    },
    onSuccess: async (saved) => {
      if (!saved) return
      setPending(null)
      setNote('')
      await client.invalidateQueries({ queryKey: ['affiliate'] })
      toast.success(t('Referral operation completed'))
    },
    onError: (error) => handleServerError(error),
  })
  let description = t(
    'Save this invitation relationship and cashback rate for future orders?'
  )
  if (pending?.action === 'withdrawal') {
    description = t(
      'Record an offline payout of {{amount}}? New cashback received after this preview will remain available.',
      {
        amount: formatCurrencyAmount(pending.amount_cents / 100, 'CNY', {
          locale,
        }),
      }
    )
  }
  if (pending?.action === 'reversal') {
    description = t(
      'Reverse the cashback for order {{order}} after verifying its refund or chargeback? Any amount already paid out becomes an offset against future cashback.',
      { order: pending.trade_no }
    )
  }
  return (
    <>
      <Dialog
        open={props.open && !verificationActive && !pending}
        onOpenChange={props.onOpenChange}
        title={t('Manage referrals')}
        description={props.username}
        contentClassName='sm:max-w-5xl'
      >
        {query.isPending && <LoadingState />}
        {query.isError && <ErrorState onRetry={() => void query.refetch()} />}
        {query.data && (
          <div className='space-y-6'>
            <AffiliateOverview summary={query.data} />
            <Button
              variant='outline'
              disabled={query.data.balance_cents <= 0 || mutation.isPending}
              onClick={() => {
                if (!query.data) return
                setNote('')
                setPending({
                  user_id: props.userId,
                  action: 'withdrawal',
                  amount_cents: query.data.balance_cents,
                  expected_paid_cents: query.data.paid_cents,
                  request_id: crypto.randomUUID(),
                  note: '',
                })
              }}
            >
              {t('Record full payout')}
            </Button>
            <Tabs defaultValue='settings'>
              <TabsList>
                <TabsTrigger value='settings'>
                  {t('Referral settings')}
                </TabsTrigger>
                <TabsTrigger value='invitees'>{t('Invited users')}</TabsTrigger>
                <TabsTrigger value='history'>
                  {t('Cashback history')}
                </TabsTrigger>
              </TabsList>
              <TabsContent value='settings'>
                <AffiliateSettingsForm
                  key={`${props.userId}:${query.data.inviter_id}:${query.data.rate_bps}`}
                  summary={query.data}
                  onSubmit={setPending}
                  disabled={mutation.isPending}
                />
              </TabsContent>
              <TabsContent value='invitees'>
                <AffiliateInvitees userId={props.userId} />
              </TabsContent>
              <TabsContent value='history'>
                <AffiliateHistory
                  userId={props.userId}
                  onReverse={(entry) => {
                    setNote('')
                    setPending({
                      user_id: props.userId,
                      action: 'reversal',
                      trade_no: entry.trade_no,
                      note: '',
                    })
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={props.open && pending !== null && !verificationActive}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setPending(null)
        }}
        title={t('Confirm referral operation')}
        desc={description}
        isLoading={mutation.isPending}
        disabled={pending?.action !== 'settings' && !note.trim()}
        handleConfirm={() => {
          if (!pending) return
          mutation.mutate(
            pending.action === 'settings'
              ? pending
              : { ...pending, note: note.trim() }
          )
        }}
      >
        {pending?.action !== 'settings' && (
          <div className='space-y-2'>
            <Label htmlFor='affiliate-note'>
              {t('Payment reference or reason')}
            </Label>
            <Textarea
              id='affiliate-note'
              maxLength={160}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={mutation.isPending}
            />
          </div>
        )}
      </ConfirmDialog>
    </>
  )
}
