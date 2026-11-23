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
import { describe, expect, test } from 'vitest'

import { CacheSubsidyProvider } from '../components/cache-subsidy-provider'
import { CampaignRowActions } from '../components/campaign-row-actions'
import { getCampaignActions } from '../lib'
import type { Campaign, CampaignStatus } from '../types'

function campaign(
  status: CampaignStatus,
  claimedUsers = 0,
  lastError = ''
): Campaign {
  return {
    id: 1,
    name: 'November cache refund',
    description: '',
    status,
    window_start: 1_794_499_200,
    window_end: 1_795_104_000,
    model_rules: ['claude*', 'gpt*'],
    include_cache_writes: true,
    subsidy_percent: 75,
    claim_deadline: 1_797_696_000,
    per_user_cap_quota: 0,
    min_subsidy_quota: 0,
    scanned_logs: 0,
    matched_logs: 0,
    skipped_logs: 0,
    skip_reasons: {},
    progress: 0,
    last_error: lastError,
    eligible_users: 3,
    total_cache_quota: 400_000,
    total_subsidy_quota: 300_000,
    claimed_users: claimedUsers,
    claimed_quota: claimedUsers * 100_000,
    calculated_at: 0,
    opened_at: 0,
    closed_at: 0,
    created_at: 0,
    updated_at: 0,
  }
}

describe('campaign actions per status', () => {
  test.each([
    ['draft', 0, '', ['edit', 'details', 'calculate', 'delete']],
    ['queued', 0, '', ['details']],
    ['calculating', 0, '', ['details']],
    ['calculating', 0, 'log database timeout', ['details', 'reset']],
    ['queued', 0, 'log database timeout', ['details', 'reset']],
    [
      'calculated',
      0,
      '',
      ['edit', 'details', 'grants', 'open', 'reset', 'delete'],
    ],
    ['open', 2, '', ['edit', 'details', 'grants', 'close']],
    // A closed campaign is the payout record: never deletable.
    ['closed', 0, '', ['details', 'grants']],
    ['closed', 2, '', ['details', 'grants']],
  ] as const)(
    'a %s campaign with %i claimed users and last error %j offers %j',
    (status, claimedUsers, lastError, expected) => {
      expect(
        getCampaignActions(campaign(status, claimedUsers, lastError))
      ).toEqual(expected)
    }
  )
})

describe('campaign row actions menu', () => {
  test('a calculated campaign offers opening claims and reset but no close, and keeps edit enabled', async () => {
    const user = userEvent.setup()
    render(
      <CacheSubsidyProvider>
        <CampaignRowActions campaign={campaign('calculated')} />
      </CacheSubsidyProvider>
    )

    expect(screen.getByRole('button', { name: 'Edit' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const items = (await screen.findAllByRole('menuitem')).map(
      (item) => item.textContent
    )
    expect(items).toEqual([
      'View details',
      'View grants',
      'Open claims',
      'Reset to draft',
      'Delete',
    ])
  })

  test('a calculating campaign disables edit and offers only its details', async () => {
    const user = userEvent.setup()
    render(
      <CacheSubsidyProvider>
        <CampaignRowActions campaign={campaign('calculating')} />
      </CacheSubsidyProvider>
    )

    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    const items = (await screen.findAllByRole('menuitem')).map(
      (item) => item.textContent
    )
    expect(items).toEqual(['View details'])
  })
})
