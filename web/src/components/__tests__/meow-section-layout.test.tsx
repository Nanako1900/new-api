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

import { MeowSectionLayout } from '../meow-section-layout'

test('the title slot renders as the page heading', () => {
  render(
    <MeowSectionLayout>
      <MeowSectionLayout.Title>Wallet</MeowSectionLayout.Title>
      <MeowSectionLayout.Content>Body</MeowSectionLayout.Content>
    </MeowSectionLayout>
  )
  expect(
    screen.getByRole('heading', { level: 1, name: 'Wallet' })
  ).toBeVisible()
})

test('content and actions slots render in place', () => {
  render(
    <MeowSectionLayout>
      <MeowSectionLayout.Title>Wallet</MeowSectionLayout.Title>
      <MeowSectionLayout.Actions>
        <button type='button'>History</button>
      </MeowSectionLayout.Actions>
      <MeowSectionLayout.Content>
        <p>Top up</p>
      </MeowSectionLayout.Content>
    </MeowSectionLayout>
  )
  expect(screen.getByRole('button', { name: 'History' })).toBeVisible()
  expect(screen.getByText('Top up')).toBeVisible()
})

test('table pages (fixedContent) are not capped to the console width', () => {
  render(
    <MeowSectionLayout fixedContent>
      <MeowSectionLayout.Title>Logs</MeowSectionLayout.Title>
      <MeowSectionLayout.Content>
        <p>Table</p>
      </MeowSectionLayout.Content>
    </MeowSectionLayout>
  )
  expect(screen.getByText('Table').parentElement).toHaveClass('max-w-none')
  expect(screen.getByText('Table').parentElement).not.toHaveClass('max-w-7xl')
})

test('other pages keep the console width', () => {
  render(
    <MeowSectionLayout>
      <MeowSectionLayout.Title>Wallet</MeowSectionLayout.Title>
      <MeowSectionLayout.Content>
        <p>Cards</p>
      </MeowSectionLayout.Content>
    </MeowSectionLayout>
  )
  expect(screen.getByText('Cards').parentElement).toHaveClass('max-w-7xl')
})
