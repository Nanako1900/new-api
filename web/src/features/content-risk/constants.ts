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
import type { RiskLevel, RiskLevelPresentation } from './types'

export const RISK_PROFILE_PAGE_SIZE = 20

export const RISK_PROFILES_QUERY_KEY = 'content-risk-profiles'

// Order of the levels in the filter, from lowest to highest.
export const RISK_LEVELS: readonly RiskLevel[] = [
  'normal',
  'watch',
  'restrict',
  'blocked',
]

// labelKey values are i18n keys; render them with t(labelKey).
export const RISK_LEVEL_PRESENTATION: Record<RiskLevel, RiskLevelPresentation> =
  {
    normal: { labelKey: 'Normal', variant: 'neutral' },
    watch: { labelKey: 'Watched', variant: 'warning' },
    restrict: { labelKey: 'Restricted', variant: 'danger' },
    blocked: { labelKey: 'Blocked', variant: 'danger' },
  }
