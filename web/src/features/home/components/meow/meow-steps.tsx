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

const STEPS = [
  {
    titleKey: 'Sign up and top up',
    bodyKey: 'Register by email, then top up or redeem a code.',
  },
  {
    titleKey: 'Create an API key',
    bodyKey: 'Set its quota and allowed models separately.',
  },
  {
    titleKey: 'Swap the Base URL',
    bodyKey: "Paste it into your client and you're ready.",
  },
] as const

export function MeowSteps() {
  const { t } = useTranslation()

  return (
    <section className='mx-auto max-w-6xl px-4 pb-24 sm:px-8'>
      <ol className='border-border grid grid-cols-1 border-y md:grid-cols-3'>
        {STEPS.map((step, index) => (
          <li
            key={step.titleKey}
            className='flex flex-col gap-2.5 py-8 md:pr-8'
          >
            <span
              aria-hidden='true'
              className='text-meow-heading font-mono text-[28px]'
            >
              {String(index + 1).padStart(2, '0')}
            </span>
            <h3 className='text-xl font-extrabold tracking-[-0.02em]'>
              {t(step.titleKey)}
            </h3>
            <p className='text-muted-foreground text-[15px]'>
              {t(step.bodyKey)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
