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

// MeowAPI: console page look (large title), same as the audit log page.
import { MeowSectionLayout as SectionPageLayout } from '@/components/meow-section-layout'

import { ContentSafetyLogTable } from './components/content-safety-log-table'

export function ContentSafetyLogs() {
  const { t } = useTranslation()
  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Content Safety Logs')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='h-full min-h-0'>
          <ContentSafetyLogTable />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
