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
import { describe, expect, it, vi } from 'vitest'

import { GroupSelector } from '@/components/model-group-selector'

const groups = [
  {
    value: 'official',
    label: 'Official',
    description: 'Official API',
    ratio: 1.3,
  },
  { value: 'budget', label: 'Budget', description: 'Shared pool', ratio: 0.4 },
]

describe('group selector expanded trigger', () => {
  it('keeps the expanded group label visible and supports keyboard selection', async () => {
    const user = userEvent.setup()
    const onGroupChange = vi.fn()
    render(
      <GroupSelector
        selectedGroup='official'
        groups={groups}
        onGroupChange={onGroupChange}
        compact={false}
      />
    )
    const trigger = screen.getByRole('combobox', { name: 'Official' })
    expect(screen.getByText('Official')).not.toHaveClass('hidden')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.type(screen.getByPlaceholderText('Search groups...'), 'Budget')
    await user.keyboard('{Enter}')
    expect(onGroupChange).toHaveBeenCalledWith('budget')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('preserves the compact trigger for existing callers', () => {
    render(
      <GroupSelector
        selectedGroup='official'
        groups={groups}
        onGroupChange={vi.fn()}
      />
    )
    expect(screen.getByText('Official')).toHaveClass('hidden')
  })
})
