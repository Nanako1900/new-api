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
import i18next from 'i18next'
import { useState, useCallback, useRef, useEffect } from 'react'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import {
  calculateAmount,
  calculateStripeAmount,
  calculateWaffoAmount,
  calculateWaffoPancakeAmount,
  requestPayment,
  requestStripePayment,
  isApiSuccess,
} from '../api'
import {
  isStripePayment,
  isWaffoPayment,
  isWaffoPancakePayment,
  submitPaymentForm,
} from '../lib'
import type { AmountRequest, AmountResponse, StripeGBPQuote } from '../types'

// ============================================================================
// Payment Hook
// ============================================================================

type AmountCalculator = (request: AmountRequest) => Promise<AmountResponse>

export interface PaymentAmountCalculators {
  regular: AmountCalculator
  stripe: AmountCalculator
  waffo: AmountCalculator
  waffoPancake: AmountCalculator
}

const defaultPaymentAmountCalculators: PaymentAmountCalculators = {
  regular: calculateAmount,
  stripe: calculateStripeAmount,
  waffo: calculateWaffoAmount,
  waffoPancake: calculateWaffoPancakeAmount,
}

export async function requestPaymentAmount(
  topupAmount: number,
  paymentType: string,
  calculators: PaymentAmountCalculators = defaultPaymentAmountCalculators
): Promise<number> {
  let calculator = calculators.regular
  if (isStripePayment(paymentType)) {
    calculator = calculators.stripe
  } else if (isWaffoPayment(paymentType)) {
    calculator = calculators.waffo
  } else if (isWaffoPancakePayment(paymentType)) {
    calculator = calculators.waffoPancake
  }

  const response = await calculator({ amount: topupAmount })
  if (!isApiSuccess(response) || !response.data) {
    return 0
  }

  return typeof response.data === 'string'
    ? Number.parseFloat(response.data)
    : Number.parseFloat(response.data.total)
}

export function usePayment(stripeGBPEnabled = false) {
  const [amount, setAmount] = useState<number>(0)
  const [calculating, setCalculating] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [stripeQuote, setStripeQuote] = useState<StripeGBPQuote | null>(null)
  const quoteRef = useRef<StripeGBPQuote | null>(null)
  const requestSequence = useRef({ value: 0 })
  const invalidateQuote = useCallback(() => {
    requestSequence.current.value++
    quoteRef.current = null
    setStripeQuote(null)
    setAmount(0)
    setCalculating(false)
  }, [])
  useEffect(() => {
    invalidateQuote()
    const pendingRequests = requestSequence.current
    return () => {
      pendingRequests.value++
    }
  }, [stripeGBPEnabled, invalidateQuote])

  // Calculate payment amount
  const calculatePaymentAmount = useCallback(
    async (topupAmount: number, paymentType: string) => {
      // Stripe Checkout uses its configured product price and currency.
      if (isStripePayment(paymentType) && !stripeGBPEnabled) {
        invalidateQuote()
        return 0
      }
      const sequence = ++requestSequence.current.value
      quoteRef.current = null
      setStripeQuote(null)
      setAmount(0)
      try {
        setCalculating(true)
        if (isStripePayment(paymentType) && stripeGBPEnabled) {
          const response = await calculateStripeAmount({
            amount: 0,
            amount_cny: topupAmount,
          })
          if (sequence !== requestSequence.current.value) return 0
          if (
            !isApiSuccess(response) ||
            !response.data ||
            typeof response.data === 'string'
          ) {
            handleServerError(response, i18next.t('Payment request failed'))
            return 0
          }
          const quote = response.data
          if (
            quote.currency !== 'GBP' ||
            quote.amount_cny !== topupAmount ||
            !quote.quote_id ||
            !(Number(quote.total) > 0)
          ) {
            return 0
          }
          quoteRef.current = quote
          setStripeQuote(quote)
          setAmount(Number(quote.total))
          return Number(quote.total)
        }
        const calculatedAmount = await requestPaymentAmount(
          topupAmount,
          paymentType
        )
        if (sequence !== requestSequence.current.value) return 0
        setAmount(calculatedAmount)
        return calculatedAmount
      } catch (error) {
        if (sequence !== requestSequence.current.value) return 0
        handleServerError(error, i18next.t('Payment request failed'))
        setAmount(0)
        return 0
      } finally {
        if (sequence === requestSequence.current.value) setCalculating(false)
      }
    },
    [stripeGBPEnabled, invalidateQuote]
  )

  // Process payment
  const processPayment = useCallback(
    async (topupAmount: number, paymentType: string) => {
      try {
        setProcessing(true)

        const isStripe = isStripePayment(paymentType)
        const amount = Math.floor(topupAmount)
        const quote = quoteRef.current
        if (
          isStripe &&
          stripeGBPEnabled &&
          (!quote || quote.amount_cny !== topupAmount)
        ) {
          return false
        }

        const response = isStripe
          ? await requestStripePayment({
              amount,
              payment_method: 'stripe',
              ...(stripeGBPEnabled
                ? {
                    amount: 0,
                    amount_cny: topupAmount,
                    quote_id: quote?.quote_id,
                  }
                : {}),
            })
          : await requestPayment({
              amount,
              payment_method: paymentType,
            })

        if (!isApiSuccess(response)) {
          handleServerError(response, i18next.t('Payment request failed'))
          return false
        }

        // Handle Stripe payment
        if (isStripe && response.data?.pay_link) {
          window.open(response.data.pay_link as string, '_blank')
          toast.success(i18next.t('Redirecting to payment page...'))
          return true
        }

        // Handle non-Stripe payment
        if (!isStripe && response.data) {
          const url = (response as unknown as { url?: string }).url
          if (url) {
            submitPaymentForm(url, response.data)
            toast.success(i18next.t('Redirecting to payment page...'))
            return true
          }
        }

        return false
      } catch (error) {
        handleServerError(error, i18next.t('Payment request failed'))
        return false
      } finally {
        setProcessing(false)
      }
    },
    [stripeGBPEnabled]
  )

  return {
    amount,
    stripeQuote,
    invalidateQuote,
    calculating,
    processing,
    calculatePaymentAmount,
    processPayment,
    setAmount,
  }
}
