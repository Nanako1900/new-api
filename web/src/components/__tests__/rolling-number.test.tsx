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
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'

import { RollingNumber } from '../rolling-number'

const dollars = (value: number) => `$${value.toFixed(2)}`

const rollingCells = (container: HTMLElement) => [
  ...container.querySelectorAll<HTMLElement>('[data-roll]'),
]

test('the first render shows the value without rolling', () => {
  const { container } = render(<RollingNumber value={67.03} format={dollars} />)

  expect(container).toHaveTextContent('$67.03')
  expect(rollingCells(container)).toHaveLength(0)
})

test('a smaller value rolls only its changed characters down', () => {
  const { container, rerender } = render(
    <RollingNumber value={67.03} format={dollars} />
  )

  rerender(<RollingNumber value={66.8} format={dollars} />)

  const cells = rollingCells(container)
  // $67.03 -> $66.80: the 7, 0 and 3 change; $, the first 6 and . stay.
  expect(cells).toHaveLength(3)
  expect(cells.every((cell) => cell.dataset.roll === 'down')).toBe(true)
})

test('a larger value rolls its changed characters up', () => {
  const { container, rerender } = render(
    <RollingNumber value={10} format={dollars} />
  )

  rerender(<RollingNumber value={12} format={dollars} />)

  const cells = rollingCells(container)
  expect(cells).toHaveLength(1)
  expect(cells[0].dataset.roll).toBe('up')
})

test('screen readers get the new value once, not the rolling characters', () => {
  const { rerender } = render(<RollingNumber value={67.03} format={dollars} />)

  rerender(<RollingNumber value={66.8} format={dollars} />)

  expect(screen.getByText('$66.80')).toBeInTheDocument()
  expect(screen.queryByText('$67.03')).not.toBeInTheDocument()
})

test('re-rendering the same value does not replay the roll', () => {
  const { container, rerender } = render(
    <RollingNumber value={67.03} format={dollars} />
  )
  rerender(<RollingNumber value={66.8} format={dollars} />)
  const [firstCell] = rollingCells(container)

  rerender(<RollingNumber value={66.8} format={dollars} />)

  expect(rollingCells(container)[0]).toBe(firstCell)
})

test('a dropped trailing zero does not shift the other places', () => {
  const plain = (value: number) => `$${value}`
  const { container, rerender } = render(
    <RollingNumber value={127.4} format={plain} />
  )

  rerender(<RollingNumber value={127.13} format={plain} />)

  // $127.4 -> $127.13: only the first decimal changes and a second appears.
  expect(rollingCells(container)).toHaveLength(2)
})

test('a new format for the same value updates the text without rolling', () => {
  const { container, rerender } = render(
    <RollingNumber value={5} format={dollars} />
  )

  rerender(<RollingNumber value={5} format={(value) => `¥${value * 7}`} />)

  expect(container).toHaveTextContent('¥35')
  expect(rollingCells(container)).toHaveLength(0)
})
