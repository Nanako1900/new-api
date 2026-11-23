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
import { COMPUTING_STATUSES, STATUSES_WITH_GRANTS } from '../constants'
import type { Campaign, CampaignAction, CampaignStatus } from '../types'

/** Whether the server is still scanning logs for the campaign. */
export function isCampaignComputing(status?: CampaignStatus): boolean {
  return status !== undefined && COMPUTING_STATUSES.includes(status)
}

/** Whether a campaign has calculated grants (and totals) to show. */
export function hasCampaignGrants(status?: CampaignStatus): boolean {
  return status !== undefined && STATUSES_WITH_GRANTS.includes(status)
}

/**
 * Window, model rules, percent, cap and minimum change only in draft. A
 * calculated or open campaign keeps its name, description and claim deadline
 * editable.
 */
export function canEditCampaignRules(status: CampaignStatus): boolean {
  return status === 'draft'
}

/**
 * The actions a campaign offers in its current status, in menu order. A
 * campaign is deleted only as a draft, or calculated or closed with nothing
 * claimed yet.
 */
export function getCampaignActions(
  campaign: Pick<Campaign, 'status' | 'claimed_users'>
): CampaignAction[] {
  const actions: CampaignAction[] = []
  const status = campaign.status

  if (status === 'draft' || status === 'calculated' || status === 'open') {
    actions.push('edit')
  }
  actions.push('details')
  if (hasCampaignGrants(status)) actions.push('grants')

  if (status === 'draft') actions.push('calculate')
  if (status === 'calculated') actions.push('open', 'reset')
  if (status === 'open') actions.push('close')

  const nothingClaimed = (campaign.claimed_users ?? 0) === 0
  if (
    status === 'draft' ||
    ((status === 'calculated' || status === 'closed') && nothingClaimed)
  ) {
    actions.push('delete')
  }
  return actions
}
