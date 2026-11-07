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
import type { ReactNode } from 'react'

import { AuthBrandLink, AuthBrandPanel } from './components/auth-brand-panel'
// MeowAPI: calico glows behind the auth pages.
import { MeowAuthBackdrop } from './components/meow-auth-backdrop'

type AuthLayoutProps = {
  children: ReactNode
}

/**
 * Split layout of the sign-in, sign-up, password and verification pages: the
 * brand panel on the left from `lg` up, the form on a glass card on the right.
 * Smaller screens show a compact brand header above the form.
 */
export function AuthLayout(props: AuthLayoutProps) {
  return (
    <div data-slot='auth-layout' className='meow-auth relative flex min-h-svh'>
      <MeowAuthBackdrop />
      <AuthBrandPanel />
      <div className='flex min-w-0 flex-1 flex-col'>
        <header className='px-4 pt-6 sm:px-8 lg:hidden'>
          <AuthBrandLink />
        </header>
        <main className='flex flex-1 items-center justify-center px-4 py-8 sm:px-8'>
          <div
            data-slot='auth-card'
            className='flex w-full max-w-[440px] flex-col gap-6 p-6 sm:p-8'
          >
            {props.children}
          </div>
        </main>
      </div>
    </div>
  )
}
