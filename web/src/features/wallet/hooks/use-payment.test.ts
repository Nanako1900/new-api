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
import { describe, expect, test, vi } from 'vitest'

import { api } from '@/lib/api'

import { PAYMENT_TYPES } from '../constants'
import { requestPaymentAmount, usePayment } from './use-payment'

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
