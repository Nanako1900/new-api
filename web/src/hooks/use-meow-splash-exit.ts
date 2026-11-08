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
import { useRouterState } from '@tanstack/react-router'
import { useEffect } from 'react'

import { dismissMeowSplash } from '@/lib/meow-splash'
import { useSystemConfigStore } from '@/stores/system-config-store'

/**
 * Retires the index.html splash once the first page is ready: the route has
 * finished loading and the site config and logo are in, so the header logo
 * the splash flies into is on screen. Use once, in the root route.
 */
export function useMeowSplashExit(): void {
  const routeReady = useRouterState({
    select: (state) => state.status === 'idle' && !state.isLoading,
  })
  const brandReady = useSystemConfigStore(
    (state) => !state.loading && state.config.logo === state.loadedLogoUrl
  )

  useEffect(() => {
    if (routeReady && brandReady) dismissMeowSplash()
  }, [routeReady, brandReady])
}
