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
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider, initReactI18next } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'

import { toIntlLocale } from '@/i18n/languages'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
  type CurrencyConfig,
} from '@/stores/system-config-store'

import { PaymentConfirmDialog } from '../components/dialogs/payment-confirm-dialog'
import { RechargeFormCard } from '../components/recharge-form-card'
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
function renderWallet(children: React.ReactNode) {
  return render(<I18nextProvider i18n={i18n}>{children}</I18nextProvider>)
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
    const view = renderWallet(
      <RechargeFormCard
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

it.each(['zhCN', 'zhTW', 'en', 'fr', 'ru', 'ja', 'vi', 'invalid_locale'])(
  'formats recharge credit for interface language %s',
  async (language) => {
    useSystemConfigStore.getState().setConfig({
      currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'CNY' },
    })
    await i18n.changeLanguage(language)
    renderWallet(
      <PaymentConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn()}
        topupAmount={10}
        paymentAmount={0}
        paymentMethod={{ name: 'Stripe', type: 'stripe' }}
        calculating={false}
        processing={false}
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
      screen.getByText('Topup Amount').nextElementSibling?.textContent
    ).toBe(expected)
  }
)

it('updates currency formatting when the interface language changes', async () => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'CNY' },
  })
  renderWallet(
    <PaymentConfirmDialog
      open
      onOpenChange={vi.fn()}
      onConfirm={vi.fn()}
      topupAmount={10}
      paymentAmount={0}
      paymentMethod={{ name: 'Stripe', type: 'stripe' }}
      calculating={false}
      processing={false}
    />
  )
  expect(screen.getByText('Topup Amount').nextElementSibling).toHaveTextContent(
    '¥10'
  )
  await act(() => i18n.changeLanguage('fr'))
  expect(screen.getByText('Topup Amount').nextElementSibling).toHaveTextContent(
    '10 ¥'
  )
})
