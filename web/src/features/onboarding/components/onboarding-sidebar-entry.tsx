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
import { Compass } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { useAuthStore } from '@/stores/auth-store'
import { useOnboardingStore } from '@/stores/onboarding-store'

/** "Getting started" at the foot of the sidebar: replays the tour. */
export function OnboardingSidebarEntry() {
  const { t } = useTranslation()
  const { setOpenMobile } = useSidebar()
  const userId = useAuthStore((state) => state.auth.user?.id)
  const startTour = useOnboardingStore((state) => state.startTour)

  if (userId === undefined) return null

  return (
    // Lifted off the bottom edge and tinted, so the way back to the tour is
    // easy to spot.
    <SidebarFooter className='mt-auto pb-5'>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip={t('Getting started')}
            className='bg-primary/10 text-foreground hover:bg-primary/15 active:bg-primary/20 font-semibold'
            onClick={() => {
              setOpenMobile(false)
              startTour(userId)
            }}
          >
            <Compass className='text-primary shrink-0' aria-hidden='true' />
            <span className='min-w-0 flex-1 truncate'>
              {t('Getting started')}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
