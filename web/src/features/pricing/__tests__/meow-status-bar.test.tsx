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
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MeowStatusBar } from '../components/meow/meow-status-bar'

// In a narrow tablet column, the 24 hourly slots must shrink with their container.
describe('Meow status bar sizing', () => {
  it('keeps hourly slots shrinkable within narrow status columns', () => {
    const slots = Array.from({ length: 24 }, (_, hour) => ({
      ts: hour * 3600,
      successRate: 100,
    }))
    const { container } = render(<MeowStatusBar slots={slots} />)
    const bar = container.firstElementChild
    expect(bar).toHaveClass('min-w-0')
    expect(bar?.children).toHaveLength(24)
    for (const slot of bar?.children ?? []) {
      expect(slot).toHaveClass('shrink')
      expect(slot).not.toHaveClass('shrink-0')
    }
  })
})
