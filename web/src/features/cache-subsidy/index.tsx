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
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'

import { CacheSubsidyDialogs } from './components/cache-subsidy-dialogs'
import {
  CacheSubsidyProvider,
  useCacheSubsidy,
} from './components/cache-subsidy-provider'
import { CampaignsTable } from './components/campaigns-table'

function CreateCampaignButton() {
  const { t } = useTranslation()
  const { setOpen, setCurrentRow } = useCacheSubsidy()
  return (
    <Button
      size='sm'
      onClick={() => {
        setCurrentRow(null)
        setOpen('create')
      }}
    >
      <Plus className='h-4 w-4' aria-hidden='true' />
      {t('Create campaign')}
    </Button>
  )
}

export function CacheSubsidies() {
  const { t } = useTranslation()
  return (
    <CacheSubsidyProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Cache Subsidies')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <CreateCampaignButton />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <CampaignsTable />
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <CacheSubsidyDialogs />
    </CacheSubsidyProvider>
  )
}
