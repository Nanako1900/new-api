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
import { useCacheSubsidy } from './cache-subsidy-provider'
import { CampaignActionDialog } from './campaign-action-dialog'
import { CampaignDetailDialog } from './campaign-detail-dialog'
import { CampaignGrantsDialog } from './campaign-grants-dialog'
import { CampaignMutateDrawer } from './campaign-mutate-drawer'

export function CacheSubsidyDialogs() {
  const { open, setOpen, currentRow } = useCacheSubsidy()
  const row = currentRow ?? undefined
  const closeOn = (isOpen: boolean) => {
    if (!isOpen) setOpen(null)
  }

  return (
    <>
      <CampaignMutateDrawer
        open={open === 'create' || open === 'update'}
        onOpenChange={closeOn}
        // Keeps the edited row while the drawer animates closed.
        currentRow={open === 'create' ? undefined : row}
      />
      <CampaignDetailDialog
        open={open === 'details'}
        onOpenChange={closeOn}
        campaign={row}
      />
      <CampaignGrantsDialog
        open={open === 'grants'}
        onOpenChange={closeOn}
        campaign={row}
      />
      <CampaignActionDialog />
    </>
  )
}
