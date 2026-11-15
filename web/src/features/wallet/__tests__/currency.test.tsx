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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import * as subscriptionsApi from '@/features/subscriptions/api'
import { SubscriptionPurchaseDialog } from '@/features/subscriptions/components/dialogs/subscription-purchase-dialog'
import type { PlanRecord } from '@/features/subscriptions/types'
import { toIntlLocale } from '@/i18n/languages'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
  type CurrencyConfig,
} from '@/stores/system-config-store'

import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
import { SubscriptionPlansCard } from '../components/subscription-plans-card'
import type { TopupInfo } from '../types'

const i18n = createInstance()
const topupInfo: TopupInfo = {
  enable_online_topup: true,
  enable_stripe_topup: true,
  pay_methods: [{ name: 'Stripe', type: 'stripe' }],
  min_topup: 1,
  stripe_min_topup: 1,
  amount_options: [100],
  discount: {},
}
const plan: PlanRecord = {
  plan: {
    id: 1,
    title: 'Monthly plan',
    price_amount: 10,
    // This is a legacy server default, not evidence of the checkout currency.
    currency: 'USD',
    duration_unit: 'month',
    duration_value: 1,
    quota_reset_period: 'never',
    enabled: true,
    sort_order: 0,
    max_purchase_per_user: 0,
    total_amount: 0,
    allow_balance_pay: true,
    allow_wallet_overflow: true,
  },
}

function renderWallet(children: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  )
}

beforeEach(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: false,
    nsSeparator: false,
    resources: {},
    interpolation: { escapeValue: false },
  })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

it.each<{ name: string; config: Partial<CurrencyConfig>; expected: string }>([
  {
    name: 'CNY at the site rate of one',
    config: { quotaDisplayType: 'CNY', usdExchangeRate: 1 },
    expected: '¥100',
  },
  {
    name: 'CNY with the configured balance conversion',
    config: { quotaDisplayType: 'CNY', usdExchangeRate: 7 },
    expected: '¥700',
  },
  {
    name: 'USD without the CNY rate',
    config: { quotaDisplayType: 'USD', usdExchangeRate: 7.3 },
    expected: '$100',
  },
  {
    name: 'custom currency with its own rate',
    config: {
      quotaDisplayType: 'CUSTOM',
      usdExchangeRate: 7.3,
      customCurrencySymbol: '€',
      customCurrencyExchangeRate: 0.9,
    },
    expected: '€ 90',
  },
  {
    name: 'raw token amounts',
    config: { quotaDisplayType: 'TOKENS', usdExchangeRate: 7.3 },
    expected: '100',
  },
])(
  'shows the same recharge credit in presets and confirmation for $name',
  ({ config, expected }) => {
    useSystemConfigStore
      .getState()
      .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG, ...config } })
    const onSelectPreset = vi.fn()
    const onAmountChange = vi.fn()
    const paymentEstimate = { paymentAmount: 730, calculating: false }
    const view = renderWallet(
      <RechargeFormCard
        {...paymentEstimate}
        topupInfo={topupInfo}
        presetAmounts={[{ value: 100 }]}
        selectedPreset={100}
        topupAmount={100}
        paymentLoading={null}
        redemptionCode=''
        redeeming={false}
        onSelectPreset={onSelectPreset}
        onTopupAmountChange={onAmountChange}
        onPaymentMethodSelect={vi.fn()}
        onRedemptionCodeChange={vi.fn()}
        onRedeem={vi.fn()}
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: (name) => name.startsWith(expected) })
    )
    expect(onSelectPreset).toHaveBeenCalledWith({ value: 100 })
    expect(screen.getByRole('spinbutton')).toHaveAccessibleDescription(
      `Balance credit: ${expected}`
    )
    fireEvent.change(screen.getByRole('spinbutton'), {
      target: { value: '120' },
    })
    expect(onAmountChange).toHaveBeenCalledWith(120)
    view.unmount()

    renderWallet(
      <PaymentConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        topupAmount={100}
        paymentAmount={730}
        paymentMethod={{ name: 'Stripe', type: 'stripe' }}
        calculating={false}
        processing={false}
      />
    )
    expect(screen.getByText(expected, { exact: true })).toBeVisible()
  }
)

it('keeps the server-calculated payment separate from the balance credit', () => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'CNY' },
  })
  renderWallet(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={100}
      paymentAmount={730}
      paymentMethod={{ name: 'Alipay', type: 'alipay' }}
      calculating={false}
      processing={false}
    />
  )
  expect(screen.getByText('¥100', { exact: true })).toBeVisible()
  expect(screen.getByText('730', { exact: true })).toBeVisible()
})

it('shows Stripe checkout guidance instead of a local payment estimate or discount', () => {
  renderWallet(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={100}
      paymentAmount={730}
      discountRate={0.8}
      paymentMethod={{ name: 'Stripe', type: 'stripe' }}
      calculating={false}
      processing={false}
    />
  )
  expect(
    screen.getByText('Final payment amount and currency are shown at checkout.')
  ).toBeVisible()
  expect(screen.queryByText('You Pay')).not.toBeInTheDocument()
  expect(screen.queryByText('You save')).not.toBeInTheDocument()
  expect(screen.queryByText('730')).not.toBeInTheDocument()
})

it('shows the actual balance debit in both the plan card and purchase dialog', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
    },
  })
  vi.spyOn(subscriptionsApi, 'getPublicPlans').mockResolvedValue({
    success: true,
    data: [plan],
  })
  vi.spyOn(subscriptionsApi, 'getSelfSubscriptionFull').mockResolvedValue({
    success: true,
    data: {
      subscriptions: [],
      all_subscriptions: [],
      billing_preference: 'subscription_first',
    },
  })
  const view = renderWallet(<SubscriptionPlansCard topupInfo={topupInfo} />)
  expect(await screen.findByText('¥70', { exact: true })).toBeVisible()
  expect(screen.getByText('Balance price')).toBeVisible()
  expect(screen.queryByText('$10.00')).not.toBeInTheDocument()
  view.unmount()
  renderWallet(
    <SubscriptionPurchaseDialog
      open
      onOpenChange={vi.fn()}
      plan={plan}
      userQuota={5_000_000}
    />
  )
  expect(
    screen.getByText('Balance price').nextElementSibling
  ).toHaveTextContent('¥70')
  expect(screen.getByText('Required').nextElementSibling).toHaveTextContent(
    '¥70'
  )
})

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'invalid_locale'])(
  'formats plan prices for interface language %s',
  async (language) => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'CNY' },
    })
    await i18n.changeLanguage(language)
    renderWallet(
      <SubscriptionPurchaseDialog
        open
        onOpenChange={vi.fn()}
        plan={plan}
        userQuota={5_000_000}
      />
    )
    const expected = new Intl.NumberFormat(toIntlLocale(language), {
      style: 'currency',
      currency: 'CNY',
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    }).format(10)
    expect(
      screen.getByText('Balance price').nextElementSibling?.textContent
    ).toBe(expected)
  }
)

it('updates currency formatting when the interface language changes', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'CNY' },
  })
  renderWallet(
    <SubscriptionPurchaseDialog
      open
      onOpenChange={vi.fn()}
      plan={plan}
      userQuota={5_000_000}
    />
  )
  expect(
    screen.getByText('Balance price').nextElementSibling
  ).toHaveTextContent('¥10')
  await act(() => i18n.changeLanguage('fr'))
  expect(
    screen.getByText('Balance price').nextElementSibling
  ).toHaveTextContent('10 ¥')
})

it('leaves an online-only plan price to the checkout provider', async () => {
  const onlineOnlyPlan: PlanRecord = {
    plan: {
      ...plan.plan,
      allow_balance_pay: false,
      stripe_price_id: 'price_actual_gateway_price',
    },
  }
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
    },
  })
  vi.spyOn(subscriptionsApi, 'getPublicPlans').mockResolvedValue({
    success: true,
    data: [onlineOnlyPlan],
  })
  vi.spyOn(subscriptionsApi, 'getSelfSubscriptionFull').mockResolvedValue({
    success: true,
    data: {
      subscriptions: [],
      all_subscriptions: [],
      billing_preference: 'subscription_first',
    },
  })
  const view = renderWallet(<SubscriptionPlansCard topupInfo={topupInfo} />)
  expect(await screen.findByText('Price shown at checkout')).toBeVisible()
  expect(screen.queryByText('Balance price')).not.toBeInTheDocument()
  expect(screen.queryByText('¥10', { exact: true })).not.toBeInTheDocument()
  expect(screen.queryByText('¥70', { exact: true })).not.toBeInTheDocument()
  view.unmount()
  renderWallet(
    <SubscriptionPurchaseDialog
      open
      onOpenChange={vi.fn()}
      plan={onlineOnlyPlan}
      enableStripe
    />
  )
  expect(screen.queryByText('Amount Due')).not.toBeInTheDocument()
  expect(screen.queryByText('Balance price')).not.toBeInTheDocument()
  expect(
    screen.getByText('Final payment amount and currency are shown at checkout.')
  ).toBeVisible()
  expect(screen.getByRole('button', { name: 'Stripe' })).toBeEnabled()
})
