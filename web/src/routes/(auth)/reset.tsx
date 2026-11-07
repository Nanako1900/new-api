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
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

import { ResetPasswordConfirm } from '@/features/auth/reset-password-confirm'

// Only the token is read; any other parameter of an older link is dropped
// together with the token when the page clears the address bar.
const searchSchema = z.object({
  token: z.string().optional().catch(undefined),
})

export const Route = createFileRoute('/(auth)/reset')({
  validateSearch: searchSchema,
  component: ResetPassword,
})

function ResetPassword() {
  const search = Route.useSearch()
  return <ResetPasswordConfirm token={search.token} />
}
