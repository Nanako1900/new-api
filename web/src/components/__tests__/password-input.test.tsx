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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { PasswordInput } from '../password-input'

describe('PasswordInput visibility toggle', () => {
  it('starts hidden, with a named toggle that is not pressed', () => {
    render(<PasswordInput aria-label='Password' />)

    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'type',
      'password'
    )
    expect(
      screen.getByRole('button', { name: 'Show password' })
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('pressing the toggle reveals the password and marks the toggle pressed', async () => {
    const user = userEvent.setup()
    render(<PasswordInput aria-label='Password' />)
    const toggle = screen.getByRole('button', { name: 'Show password' })

    await user.click(toggle)

    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('a disabled input also disables the toggle', () => {
    render(<PasswordInput aria-label='Password' disabled />)

    expect(screen.getByRole('button', { name: 'Show password' })).toBeDisabled()
  })
})
