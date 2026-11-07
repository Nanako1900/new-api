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
/**
 * MeowAPI: calico glows behind the auth pages (orange top-left, ink on the
 * right, like the logo's patches). The glass card and the brand panel's
 * ledge are styled through `.meow-auth [data-slot=...]` in meow.css.
 */
export function MeowAuthBackdrop() {
  return (
    <div
      aria-hidden='true'
      className='pointer-events-none absolute inset-0 -z-10 overflow-hidden'
    >
      <div className='absolute top-1/2 left-1/2 h-0 w-0'>
        <div className='meow-drift-a bg-meow-orange absolute -top-72 -left-80 h-72 w-96 rounded-full opacity-45 blur-[80px]' />
        <div className='meow-drift-b bg-meow-ink absolute top-0 left-40 h-64 w-80 rounded-full opacity-20 blur-[80px] dark:bg-white dark:opacity-10' />
      </div>
    </div>
  )
}
