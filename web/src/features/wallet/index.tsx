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
import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

// MeowAPI: console page look (large title) for the wallet.
import { MeowSectionLayout as SectionPageLayout } from '@/components/meow-section-layout'
import { AffiliateCard } from '@/features/affiliate/components/affiliate-card'
import { getSelf } from '@/lib/api'

import { AffiliateRewardsCard } from './components/affiliate-rewards-card'
import { BillingHistoryDialog } from './components/dialogs/billing-history-dialog'
import { CreemConfirmDialog } from './components/dialogs/creem-confirm-dialog'
import { PaymentConfirmDialog } from './components/dialogs/payment-confirm-dialog'
import { TransferDialog } from './components/dialogs/transfer-dialog'
// MeowAPI: balance on the dark calico tile.
import { MeowWalletStatsCard as WalletStatsCard } from './components/meow-wallet-stats-card'
import { RechargeFormCard } from './components/recharge-form-card'
import { SubscriptionPlansCard } from './components/subscription-plans-card'
import { PAYMENT_TYPES } from './constants'
import {
  useTopupInfo,
  usePayment,
  useAffiliate,
  useRedemption,
  useCreemPayment,
  useWaffoPayment,
  useWaffoPancakePayment,
  useNanakoPayPayment,
} from './hooks'
import {
  getDefaultPaymentType,
  rechargePromotion,
  getMinTopupAmount,
  dispatchSelectedPayment,
} from './lib'
import type {
  UserWalletData,
  PaymentMethod,
  PresetAmount,
  CreemProduct,
  WaffoPayMethod,
} from './types'

interface WalletProps {
  initialShowHistory?: boolean
}

export function Wallet(props: WalletProps) {
  const { t } = useTranslation()
  const [user, setUser] = useState<UserWalletData | null>(null)
  const [userLoading, setUserLoading] = useState(true)
  const [topupAmount, setTopupAmount] = useState(0)
  const [stripeAmountCNY, setStripeAmountCNY] = useState(100)
  const [selectedPreset, setSelectedPreset] = useState<number | null>(null)
  const [selectedPaymentMethod, setSelectedPaymentMethod] =
    useState<PaymentMethod>()
  const [selectedWaffoMethodIndex, setSelectedWaffoMethodIndex] = useState<
    number | null
  >(null)
  const [paymentLoading, setPaymentLoading] = useState<string | null>(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false)
  const [transferDialogOpen, setTransferDialogOpen] = useState(false)
  const [billingDialogOpen, setBillingDialogOpen] = useState(false)
  const [redemptionCode, setRedemptionCode] = useState('')
  const [creemDialogOpen, setCreemDialogOpen] = useState(false)
  const [selectedCreemProduct, setSelectedCreemProduct] =
    useState<CreemProduct | null>(null)
  const [showSubscriptionPanel, setShowSubscriptionPanel] = useState(true)

  const { topupInfo, presetAmounts, loading: topupLoading } = useTopupInfo()

  const {
    amount: paymentAmount,
    stripeQuote,
    invalidateQuote,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
  } = usePayment(!!topupInfo?.stripe_gbp_enabled)
  const {
    affiliateLink,
    loading: affiliateLoading,
    transferQuota,
    transferring,
  } = useAffiliate()
  const { redeeming, redeemCode } = useRedemption()
  const { processing: creemProcessing, processCreemPayment } = useCreemPayment()
  const { processing: waffoProcessing, processWaffoPayment } = useWaffoPayment()
  const { processing: pancakeProcessing, processWaffoPancakePayment } =
    useWaffoPancakePayment()
  const { processing: nanakoPayProcessing, processNanakoPayPayment } =
    useNanakoPayPayment()

  // Fetch and refresh user data
  const fetchUser = useCallback(async () => {
    try {
      setUserLoading(true)
      const response = await getSelf()
      if (response.success && response.data) {
        setUser(response.data as UserWalletData)
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch user data:', error)
    } finally {
      setUserLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUser()
  }, [fetchUser])

  useEffect(() => {
    if (props.initialShowHistory) {
      setBillingDialogOpen(true)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [props.initialShowHistory])

  // Initialize topup amount when topup info is loaded
  const topupAmountInitializedRef = useRef(false)
  useEffect(() => {
    if (topupInfo && !topupAmountInitializedRef.current) {
      topupAmountInitializedRef.current = true
      const minTopup = getMinTopupAmount(topupInfo)
      setTopupAmount(minTopup)
      if (topupInfo.stripe_gbp_enabled) {
        setStripeAmountCNY(
          Math.max(
            100,
            Math.ceil(
              topupInfo.stripe_min_topup *
                (topupInfo.stripe_usd_exchange_rate ?? 1)
            )
          )
        )
      }

      // Calculate initial payment amount with default payment type
      const defaultPaymentType = getDefaultPaymentType(topupInfo)
      if (
        !topupInfo.stripe_gbp_enabled ||
        defaultPaymentType !== PAYMENT_TYPES.STRIPE
      ) {
        calculatePaymentAmount(minTopup, defaultPaymentType)
      }
    }
  }, [topupInfo, calculatePaymentAmount])

  // Get current payment type (selected or default)
  const getCurrentPaymentType = useCallback(() => {
    return selectedPaymentMethod?.type || getDefaultPaymentType(topupInfo)
  }, [selectedPaymentMethod, topupInfo])

  const stripeGBPCurrent =
    !!topupInfo?.stripe_gbp_enabled &&
    getCurrentPaymentType() === PAYMENT_TYPES.STRIPE
  const currentTopupAmount = stripeGBPCurrent ? stripeAmountCNY : topupAmount

  // Handle preset selection
  const handleSelectPreset = (preset: PresetAmount) => {
    if (stripeGBPCurrent) setStripeAmountCNY(preset.value)
    else setTopupAmount(preset.value)
    setSelectedPreset(preset.value)
    if (stripeGBPCurrent) invalidateQuote()
    else calculatePaymentAmount(preset.value, getCurrentPaymentType())
  }

  // Handle topup amount change
  const handleTopupAmountChange = (amount: number) => {
    if (stripeGBPCurrent) setStripeAmountCNY(amount)
    else setTopupAmount(amount)
    setSelectedPreset(null)
    if (stripeGBPCurrent) invalidateQuote()
    else calculatePaymentAmount(amount, getCurrentPaymentType())
  }

  // Handle payment method selection
  const handlePaymentMethodSelect = async (method: PaymentMethod) => {
    const isGBP =
      !!topupInfo?.stripe_gbp_enabled && method.type === PAYMENT_TYPES.STRIPE
    let requestedAmount = isGBP ? stripeAmountCNY : topupAmount
    if (isGBP && !stripeGBPCurrent) {
      requestedAmount = Math.round(
        topupAmount * (topupInfo?.stripe_usd_exchange_rate ?? 1)
      )
      setStripeAmountCNY(requestedAmount)
    } else if (!isGBP && stripeGBPCurrent) {
      requestedAmount = Math.floor(
        stripeAmountCNY / (topupInfo?.stripe_usd_exchange_rate ?? 1)
      )
      setTopupAmount(requestedAmount)
    }
    setSelectedPreset(null)
    setSelectedPaymentMethod(method)
    setSelectedWaffoMethodIndex(null)
    setPaymentLoading(method.type)
    try {
      const minTopup = getMinTopupAmount(topupInfo)
      if (!isGBP && requestedAmount < minTopup) return
      const total = await calculatePaymentAmount(requestedAmount, method.type)
      if (!isGBP || total > 0) setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  // Handle payment confirmation
  const handlePaymentConfirm = async () => {
    if (!selectedPaymentMethod) return

    const success = await dispatchSelectedPayment(
      selectedPaymentMethod,
      currentTopupAmount,
      selectedWaffoMethodIndex,
      {
        regular: processPayment,
        waffo: processWaffoPayment,
        waffoPancake: processWaffoPancakePayment,
        nanakoPay: processNanakoPayPayment,
      }
    )

    if (success) {
      setConfirmDialogOpen(false)
      await fetchUser()
    }
  }

  // Handle redemption
  const handleRedeem = async () => {
    if (!redemptionCode) return

    const success = await redeemCode(redemptionCode)
    if (success) {
      setRedemptionCode('')
      await fetchUser()
    }
  }

  // Handle transfer
  const handleTransfer = async (amount: number) => {
    const success = await transferQuota(amount)
    if (success) {
      await fetchUser()
    }
    return success
  }

  // Handle Creem product selection
  const handleCreemProductSelect = (product: CreemProduct) => {
    setSelectedCreemProduct(product)
    setCreemDialogOpen(true)
  }

  // Handle Creem payment confirmation
  const handleCreemConfirm = async () => {
    if (!selectedCreemProduct) return

    const success = await processCreemPayment(selectedCreemProduct.productId)
    if (success) {
      setCreemDialogOpen(false)
      setSelectedCreemProduct(null)
      await fetchUser()
    }
  }

  const handleWaffoMethodSelect = async (
    method: WaffoPayMethod,
    index: number
  ) => {
    const requestedAmount = stripeGBPCurrent
      ? Math.floor(stripeAmountCNY / (topupInfo?.stripe_usd_exchange_rate ?? 1))
      : topupAmount
    setTopupAmount(requestedAmount)
    setSelectedPreset(null)
    const loadingKey = `waffo-${index}`
    setSelectedPaymentMethod({
      name: method.name,
      type: PAYMENT_TYPES.WAFFO,
      icon: method.icon,
    })
    setSelectedWaffoMethodIndex(index)
    setPaymentLoading(loadingKey)

    try {
      await calculatePaymentAmount(requestedAmount, PAYMENT_TYPES.WAFFO)
      setConfirmDialogOpen(true)
    } finally {
      setPaymentLoading(null)
    }
  }

  const promotion = stripeGBPCurrent
    ? stripeQuote
    : rechargePromotion(topupInfo, currentTopupAmount, false)
  const discountRate = Math.min(
    topupInfo?.discount?.[topupAmount] || 1,
    (promotion?.pay_percent ?? 100) / 100
  )

  const handleSubscriptionAvailabilityChange = useCallback(
    (available: boolean) => {
      setShowSubscriptionPanel(available)
    },
    []
  )

  return (
    <>
      <SectionPageLayout>
        <SectionPageLayout.Title>{t('Wallet')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <div className='mx-auto flex w-full max-w-7xl flex-col gap-4 sm:gap-5'>
            <WalletStatsCard user={user} loading={userLoading} />

            <div
              className={
                showSubscriptionPanel
                  ? 'grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:items-start'
                  : 'grid gap-4'
              }
            >
              <div id='wallet-add-funds' className='scroll-mt-4'>
                <RechargeFormCard
                  topupInfo={topupInfo}
                  presetAmounts={presetAmounts}
                  selectedPreset={selectedPreset}
                  onSelectPreset={handleSelectPreset}
                  topupAmount={currentTopupAmount}
                  cnyAmounts={stripeGBPCurrent}
                  onTopupAmountChange={handleTopupAmountChange}
                  onPaymentMethodSelect={handlePaymentMethodSelect}
                  paymentLoading={paymentLoading}
                  redemptionCode={redemptionCode}
                  onRedemptionCodeChange={setRedemptionCode}
                  onRedeem={handleRedeem}
                  redeeming={redeeming}
                  topupLink={topupInfo?.topup_link}
                  loading={topupLoading}
                  onOpenBilling={() => setBillingDialogOpen(true)}
                  creemProducts={topupInfo?.creem_products}
                  enableCreemTopup={topupInfo?.enable_creem_topup}
                  onCreemProductSelect={handleCreemProductSelect}
                  enableWaffoTopup={topupInfo?.enable_waffo_topup}
                  waffoPayMethods={topupInfo?.waffo_pay_methods}
                  waffoMinTopup={topupInfo?.waffo_min_topup}
                  onWaffoMethodSelect={handleWaffoMethodSelect}
                  enableWaffoPancakeTopup={
                    topupInfo?.enable_waffo_pancake_topup
                  }
                  enableNanakoPayTopup={topupInfo?.enable_nanako_pay_topup}
                />
              </div>

              <SubscriptionPlansCard
                topupInfo={topupInfo}
                onAvailabilityChange={handleSubscriptionAvailabilityChange}
                userQuota={user?.quota}
                onPurchaseSuccess={fetchUser}
              />
            </div>

            <AffiliateCard />
            <AffiliateRewardsCard
              user={user}
              affiliateLink={affiliateLink}
              onTransfer={() => setTransferDialogOpen(true)}
              complianceConfirmed={
                topupInfo?.payment_compliance_confirmed !== false
              }
              loading={affiliateLoading}
            />
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <PaymentConfirmDialog
        open={confirmDialogOpen}
        onOpenChange={setConfirmDialogOpen}
        onConfirm={handlePaymentConfirm}
        topupAmount={currentTopupAmount}
        paymentAmount={paymentAmount}
        paymentMethod={selectedPaymentMethod}
        calculating={calculating}
        processing={
          processing ||
          waffoProcessing ||
          pancakeProcessing ||
          nanakoPayProcessing
        }
        discountRate={discountRate}
        promotion={promotion}
        stripeQuote={stripeQuote}
        stripeGBPEnabled={topupInfo?.stripe_gbp_enabled}
        stripeFeeEnabled={topupInfo?.stripe_fee_enabled}
        stripeFeePercent={topupInfo?.stripe_fee_percent}
        stripeFeeFixedCNY={topupInfo?.stripe_fee_fixed_cny}
        nanakoPayCurrency={topupInfo?.nanako_pay_currency}
      />

      <TransferDialog
        open={transferDialogOpen}
        onOpenChange={setTransferDialogOpen}
        onConfirm={handleTransfer}
        availableQuota={user?.aff_quota ?? 0}
        transferring={transferring}
      />

      <BillingHistoryDialog
        open={billingDialogOpen}
        onOpenChange={setBillingDialogOpen}
      />

      <CreemConfirmDialog
        open={creemDialogOpen}
        onOpenChange={setCreemDialogOpen}
        onConfirm={handleCreemConfirm}
        product={selectedCreemProduct}
        processing={creemProcessing}
      />
    </>
  )
}
