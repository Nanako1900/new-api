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
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { PAYMENT_TYPES } from '../constants'
import { requestPaymentAmount, usePayment } from './use-payment'

afterEach(() => vi.restoreAllMocks())

describe('payment amount routing', () => {
  test('leaves Stripe totals to checkout without requesting the legacy local quote', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { message: 'success', data: '730' },
    })
    const { result } = renderHook(() => usePayment())
    await act(async () => {
      await result.current.calculatePaymentAmount(100, 'alipay')
    })
    expect(result.current.amount).toBe(730)
    post.mockClear()

    await act(async () => {
      await result.current.calculatePaymentAmount(100, PAYMENT_TYPES.STRIPE)
    })
    expect(post).not.toHaveBeenCalled()
    expect(result.current.amount).toBe(0)
    expect(result.current.calculating).toBe(false)
  })

  test('uses the dedicated Waffo amount calculator', async () => {
    const calls: string[] = []
    const amount = await requestPaymentAmount(120, PAYMENT_TYPES.WAFFO, {
      regular: async () => {
        calls.push('regular')
        return { success: true, data: '1' }
      },
      stripe: async () => {
        calls.push('stripe')
        return { success: true, data: '2' }
      },
      waffo: async (request) => {
        calls.push(`waffo:${request.amount}`)
        return { success: true, data: '18.75' }
      },
      waffoPancake: async () => {
        calls.push('pancake')
        return { success: true, data: '4' }
      },
    })

    expect(amount).toBe(18.75)
    expect(calls).toEqual(['waffo:120'])
  })
})

const gbpQuote = {
  currency: 'GBP',
  amount_cny: 100,
  principal: '12.50',
  fee: '0.57',
  total: '13.07',
  exchange_rate: '8',
  quote_id: 'quote100',
} as const

test('quotes explicit CNY units and sends the confirmed GBP quote when paying', async () => {
  const post = vi
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { message: 'success', data: gbpQuote } })
    .mockResolvedValueOnce({
      data: {
        message: 'success',
        data: { pay_link: 'https://checkout.stripe.com/local' },
      },
    })
  vi.spyOn(window, 'open').mockReturnValue(null)
  const { result } = renderHook(() => usePayment(true))
  await act(async () => {
    await result.current.calculatePaymentAmount(100, 'stripe')
  })
  expect(post).toHaveBeenNthCalledWith(
    1,
    '/api/user/stripe/amount',
    {
      amount: 0,
      amount_cny: 100,
    },
    { skipBusinessError: true }
  )
  expect(result.current.amount).toBe(13.07)
  expect(result.current.stripeQuote?.amount_cny).toBe(100)
  await act(async () => {
    expect(await result.current.processPayment(100, 'stripe')).toBe(true)
  })
  expect(post).toHaveBeenNthCalledWith(
    2,
    '/api/user/stripe/pay',
    {
      amount: 0,
      amount_cny: 100,
      payment_method: 'stripe',
      quote_id: 'quote100',
    },
    { skipBusinessError: true }
  )
  act(() => result.current.invalidateQuote())
  await act(async () => {
    expect(await result.current.processPayment(100, 'stripe')).toBe(false)
  })
  expect(post).toHaveBeenCalledTimes(2)
})

test('ignores a stale GBP quote after the recharge amount changes', async () => {
  let resolveQuote: (value: unknown) => void = () => {}
  vi.spyOn(api, 'post').mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveQuote = resolve
      })
  )
  const { result } = renderHook(() => usePayment(true))
  let pending: Promise<number>
  act(() => {
    pending = result.current.calculatePaymentAmount(100, 'stripe')
  })
  act(() => result.current.invalidateQuote())
  await act(async () => {
    resolveQuote({ data: { message: 'success', data: gbpQuote } })
    await pending
  })
  expect(result.current.stripeQuote).toBeNull()
  expect(result.current.amount).toBe(0)
  expect(result.current.calculating).toBe(false)
})
