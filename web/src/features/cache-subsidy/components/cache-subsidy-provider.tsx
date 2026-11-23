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
import React, { useState } from 'react'

import useDialogState from '@/hooks/use-dialog'

import type {
  Campaign,
  CampaignTransition,
  CampaignsDialogType,
} from '../types'

/** A status change or deletion waiting for the administrator's confirmation. */
export type PendingCampaignAction = {
  campaign: Campaign
  action: CampaignTransition | 'delete'
}

type CacheSubsidyContextType = {
  open: CampaignsDialogType | null
  setOpen: (dialog: CampaignsDialogType | null) => void
  currentRow: Campaign | null
  setCurrentRow: React.Dispatch<React.SetStateAction<Campaign | null>>
  pendingAction: PendingCampaignAction | null
  setPendingAction: (action: PendingCampaignAction | null) => void
}

const CacheSubsidyContext = React.createContext<CacheSubsidyContextType | null>(
  null
)

export function CacheSubsidyProvider(props: { children: React.ReactNode }) {
  const [open, setOpen] = useDialogState<CampaignsDialogType>(null)
  const [currentRow, setCurrentRow] = useState<Campaign | null>(null)
  const [pendingAction, setPendingAction] =
    useState<PendingCampaignAction | null>(null)

  return (
    <CacheSubsidyContext
      value={{
        open,
        setOpen,
        currentRow,
        setCurrentRow,
        pendingAction,
        setPendingAction,
      }}
    >
      {props.children}
    </CacheSubsidyContext>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCacheSubsidy() {
  const context = React.useContext(CacheSubsidyContext)
  if (!context) {
    throw new Error(
      'useCacheSubsidy has to be used within <CacheSubsidyProvider>'
    )
  }
  return context
}
