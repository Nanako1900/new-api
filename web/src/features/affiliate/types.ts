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
export interface AffiliateSummary {
  user_id: number
  inviter_id: number
  inviter_name: string
  invite_count: number
  rate_bps: number
  balance_cents: number
  earned_cents: number
  paid_cents: number
  reversed_cents: number
}

export interface AffiliateEntry {
  id: number
  kind: 'credit' | 'withdrawal' | 'reversal'
  trade_no: string
  buyer_id: number
  rate_bps: number
  base_cents: number
  amount_cents: number
  balance_after: number
  operator_id: number
  note: string
  created_at: number
}

export type AffiliateAction =
  | {
      user_id: number
      action: 'settings'
      inviter_id: number
      rate_bps: number
    }
  | {
      user_id: number
      action: 'withdrawal'
      amount_cents: number
      expected_paid_cents: number
      request_id: string
      note: string
    }
  | { user_id: number; action: 'reversal'; trade_no: string; note: string }

export interface AffiliatePage<T> {
  items: T[]
  total: number
}
export interface Invitee {
  id: number
  username: string
  display_name: string
}
