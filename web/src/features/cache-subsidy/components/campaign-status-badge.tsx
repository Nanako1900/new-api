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
import { useTranslation } from 'react-i18next'

import { StatusBadge } from '@/components/status-badge'
import { formatPercent } from '@/lib/format'

import { CAMPAIGN_STATUSES } from '../constants'
import type { Campaign } from '../types'

/** Campaign status; a calculating campaign also shows how far it has got. */
export function CampaignStatusBadge(props: {
  campaign: Pick<Campaign, 'status' | 'progress'>
  className?: string
}) {
  const { t } = useTranslation()
  const config = CAMPAIGN_STATUSES[props.campaign.status]
  if (!config) return null

  const label =
    props.campaign.status === 'calculating'
      ? `${t(config.labelKey)} ${formatPercent(props.campaign.progress)}`
      : t(config.labelKey)

  return (
    <StatusBadge
      label={label}
      variant={config.variant}
      copyable={false}
      className={props.className}
    />
  )
}
