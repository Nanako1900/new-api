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
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toIntlLocale } from '@/i18n/languages'
import { formatCurrencyAmount } from '@/lib/currency'
import { formatNumber } from '@/lib/format'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { DEFAULT_DISCOUNT_RATE } from '../../constants'
import {
  formatCurrency,
  formatTopupCredit,
  getPaymentIcon,
  isStripePayment,
} from '../../lib'
import type { PaymentMethod, StripeGBPQuote } from '../../types'

interface PaymentConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  topupAmount: number
  paymentAmount: number
  paymentMethod: PaymentMethod | undefined
  calculating: boolean
  processing: boolean
  discountRate?: number
  stripeQuote?: StripeGBPQuote | null
  stripeGBPEnabled?: boolean
  stripeFeeEnabled?: boolean
  stripeFeePercent?: number
  stripeFeeFixedCNY?: number
}

export function PaymentConfirmDialog(props: PaymentConfirmDialogProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  useSystemConfigStore((state) => state.config.currency)
  const isStripe = isStripePayment(props.paymentMethod?.type || '')
  const discountRate = props.discountRate ?? DEFAULT_DISCOUNT_RATE
  const hasDiscount =
    !isStripe && discountRate > 0 && discountRate < 1 && props.paymentAmount > 0
  const originalAmount = hasDiscount ? props.paymentAmount / discountRate : 0
  const discountAmount = hasDiscount ? originalAmount - props.paymentAmount : 0

  return (
    <ConfirmDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Confirm Payment')}
      desc={t('Review your payment details')}
      confirmText={t('Confirm Payment')}
      handleConfirm={props.onConfirm}
      isLoading={props.processing}
      disabled={
        props.calculating ||
        (isStripe &&
          !!props.stripeGBPEnabled &&
          (!props.stripeQuote ||
            props.stripeQuote.amount_cny !== props.topupAmount))
      }
      className='max-sm:w-[calc(100vw-1.5rem)] sm:max-w-md'
    >
      <div className='space-y-3 py-3 sm:space-y-4 sm:py-4'>
        <div className='flex items-center justify-between gap-3'>
          <span className='text-muted-foreground text-sm'>
            {t('Topup Amount')}
          </span>
          <span className='text-lg font-semibold'>
            {isStripe && props.stripeGBPEnabled
              ? formatCurrencyAmount(props.topupAmount, 'CNY', { locale })
              : formatTopupCredit(props.topupAmount, { locale })}
          </span>
        </div>

        {!isStripe && (
          <div className='flex items-center justify-between gap-3'>
            <span className='text-muted-foreground text-sm'>
              {t('You Pay')}
            </span>
            {props.calculating ? (
              <Skeleton className='h-6 w-24' />
            ) : (
              <div className='flex items-baseline gap-2'>
                <span className='text-2xl font-semibold'>
                  {formatCurrency(props.paymentAmount)}
                </span>
                {hasDiscount && (
                  <span className='text-muted-foreground text-sm line-through'>
                    {formatCurrency(originalAmount)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {isStripe && props.stripeQuote && (
          <div className='space-y-2 text-sm'>
            <div className='flex justify-between gap-3'>
              <span>{t('You Pay')}</span>
              <strong>
                {formatCurrencyAmount(Number(props.stripeQuote.total), 'GBP', {
                  locale,
                })}
              </strong>
            </div>
            <p className='text-muted-foreground'>
              {t('Exchange rate: 1 GBP = {{rate}} CNY', {
                rate: props.stripeQuote.exchange_rate,
              })}
            </p>
            <p className='text-muted-foreground'>
              {t('Stripe processing fee')}:{' '}
              {formatCurrencyAmount(Number(props.stripeQuote.fee), 'GBP', {
                locale,
              })}
            </p>
          </div>
        )}
        {isStripe && !props.stripeGBPEnabled && (
          <p className='text-muted-foreground text-sm'>
            {t('Final payment amount and currency are shown at checkout.')}
          </p>
        )}

        {isStripe && props.stripeFeeEnabled && !props.stripeGBPEnabled && (
          <div className='bg-muted/50 space-y-1.5 rounded-lg p-3 text-sm'>
            <div className='font-medium'>{t('Stripe processing fee')}</div>
            <p>
              {t('{{percent}}% + {{fixed}} per payment', {
                percent: formatNumber(props.stripeFeePercent ?? 0, locale),
                fixed: formatCurrencyAmount(
                  props.stripeFeeFixedCNY ?? 0,
                  'CNY',
                  { locale }
                ),
              })}
            </p>
            <p className='text-muted-foreground text-xs'>
              {t(
                'Added at Stripe Checkout. Processing fees are not credited to your balance.'
              )}
            </p>
          </div>
        )}

        {hasDiscount && !props.calculating && (
          <div className='bg-muted/50 rounded-lg p-3'>
            <div className='flex items-center justify-between text-sm'>
              <span className='text-muted-foreground'>{t('You save')}</span>
              <span className='font-semibold text-green-600'>
                {formatCurrency(discountAmount)}
              </span>
            </div>
          </div>
        )}

        <div className='border-t pt-4'>
          <div className='flex items-center justify-between gap-3'>
            <span className='text-muted-foreground text-sm'>
              {t('Payment Method')}
            </span>
            <div className='flex items-center gap-2'>
              {getPaymentIcon(
                props.paymentMethod?.type,
                'h-4 w-4',
                props.paymentMethod?.icon,
                props.paymentMethod?.name
              )}
              <span className='font-medium'>{props.paymentMethod?.name}</span>
            </div>
          </div>
        </div>
      </div>
    </ConfirmDialog>
  )
}
