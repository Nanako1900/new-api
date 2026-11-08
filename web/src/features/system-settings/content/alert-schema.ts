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
import * as z from 'zod'

import {
  ALERT_CONTENT_MAX_LENGTH,
  ALERT_LEVELS,
  ALERT_TITLE_MAX_LENGTH,
} from '@/features/console-alerts/constants'

/** Form rules; kept equal to the server's validateAlerts. */
export const alertFormSchema = z
  .object({
    title: z
      .string()
      .trim()
      .max(ALERT_TITLE_MAX_LENGTH, 'Title must be at most 100 characters'),
    content: z
      .string()
      .trim()
      .min(1, 'Content is required')
      .max(ALERT_CONTENT_MAX_LENGTH, 'Content must be at most 500 characters'),
    level: z.enum(ALERT_LEVELS),
    dismissible: z.boolean(),
    enabled: z.boolean(),
    // ISO strings from DateTimePicker; an empty string means no bound.
    startsAt: z.string(),
    endsAt: z.string(),
  })
  .refine(
    (values) =>
      !values.startsAt ||
      !values.endsAt ||
      new Date(values.endsAt).getTime() > new Date(values.startsAt).getTime(),
    { message: 'End time must be after start time', path: ['endsAt'] }
  )

export type AlertFormValues = z.infer<typeof alertFormSchema>

export const EMPTY_ALERT_FORM: AlertFormValues = {
  title: '',
  content: '',
  level: 'info',
  dismissible: true,
  enabled: true,
  startsAt: '',
  endsAt: '',
}
