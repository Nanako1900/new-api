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
/** Date helpers for the compact overview check-in card (local time). */

const pad = (value: number) => String(value).padStart(2, '0')

/** `YYYY-MM-DD`, the format of `checkin_date` in check-in records. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `YYYY-MM`, the month parameter of the check-in status API. */
export function toMonthKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** The seven days ending today, oldest first. */
export function lastSevenDays(today: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => shiftDays(today, index - 6))
}

/**
 * Consecutive check-in days up to today. A missing check-in today does not
 * break the streak yet, so counting starts from yesterday in that case.
 */
export function checkinStreak(today: Date, checked: Set<string>): number {
  let day = checked.has(toDateKey(today)) ? today : shiftDays(today, -1)
  let streak = 0
  while (checked.has(toDateKey(day))) {
    streak += 1
    day = shiftDays(day, -1)
  }
  return streak
}

export type CalendarCell = { date: Date; inMonth: boolean }

/** Calendar cells for the month of `month`, Sunday first, whole weeks. */
export function monthGrid(month: Date): CalendarCell[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0
  ).getDate()
  const leading = first.getDay()
  const total = Math.ceil((leading + daysInMonth) / 7) * 7
  return Array.from({ length: total }, (_, index) => {
    const date = shiftDays(first, index - leading)
    return { date, inMonth: date.getMonth() === first.getMonth() }
  })
}
