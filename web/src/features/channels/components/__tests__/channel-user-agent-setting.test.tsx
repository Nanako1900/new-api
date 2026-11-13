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
import { zodResolver } from '@hookform/resolvers/zod'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { afterEach, expect, test, vi } from 'vitest'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'

import { getChannelConfigurationState } from '../../lib/channel-configuration'
import {
  buildSettingJSON,
  CHANNEL_FORM_DEFAULT_VALUES,
  channelFormSchema,
  transformChannelToFormDefaults,
  type ChannelFormValues,
} from '../../lib/channel-form'
import { channelSchema } from '../../types'
import { ChannelUserAgentSetting } from '../channel-user-agent-setting'

afterEach(cleanup)

function PolicyForm(props: {
  values?: Partial<ChannelFormValues>
  disabled?: boolean
  onSave: (value: string) => void
}) {
  const form = useForm<ChannelFormValues>({
    resolver: zodResolver(channelFormSchema),
    defaultValues: {
      ...CHANNEL_FORM_DEFAULT_VALUES,
      name: 'Dedicated channel',
      key: 'test-only',
      models: 'claude-test',
      ...props.values,
    },
  })
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((value) =>
          props.onSave(buildSettingJSON(value))
        )}
      >
        <ChannelUserAgentSetting disabled={props.disabled} />
        <Button type='submit'>Save</Button>
      </form>
    </Form>
  )
}

test('new channels leave UA restrictions off and enabling saves the Claude Code preset', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<PolicyForm onSave={onSave} />)
  const toggle = screen.getByRole('switch', {
    name: 'Restrict client User-Agent',
  })
  expect(toggle).not.toBeChecked()
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(JSON.parse(onSave.mock.calls[0][0])).not.toHaveProperty(
    'user_agent_policy'
  )
  await user.click(toggle)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(JSON.parse(onSave.mock.calls[1][0]).user_agent_policy).toEqual({
    enabled: true,
    profile: 'claude_code',
  })
  expect(screen.getByText(/User-Agent can be spoofed/)).toBeInTheDocument()
})

test('custom rules require a value, save both match types, and survive disabling and re-enabling', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(
    <PolicyForm
      values={{ user_agent_restriction_enabled: true }}
      onSave={onSave}
    />
  )
  await user.click(screen.getByRole('combobox', { name: 'Allowed client' }))
  await user.click(
    screen.getByRole('option', { name: 'Custom User-Agent allowlist' })
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).not.toHaveBeenCalled()
  expect(
    screen.getByText('User-Agent allowlist must contain between 1 and 20 rules')
  ).toBeInTheDocument()
  await user.type(
    screen.getByRole('textbox', { name: 'Exact User-Agent matches' }),
    'MyTool/1.0'
  )
  await user.type(
    screen.getByRole('textbox', { name: 'Allowed User-Agent prefixes' }),
    'MyAgent/'
  )
  await user.click(screen.getByRole('button', { name: 'Save' }))
  const policy = {
    enabled: true,
    profile: 'custom',
    rules: [
      { match: 'exact', value: 'MyTool/1.0' },
      { match: 'prefix', value: 'MyAgent/' },
    ],
  }
  expect(JSON.parse(onSave.mock.calls[0][0]).user_agent_policy).toEqual(policy)
  const toggle = screen.getByRole('switch', {
    name: 'Restrict client User-Agent',
  })
  toggle.focus()
  await user.keyboard(' ')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(JSON.parse(onSave.mock.calls[1][0]).user_agent_policy).toEqual({
    ...policy,
    enabled: false,
  })
  await user.click(toggle)
  expect(
    screen.getByRole('textbox', { name: 'Exact User-Agent matches' })
  ).toHaveValue('MyTool/1.0')
})

test('locked settings disable the switch, profile, and custom inputs', async () => {
  const user = userEvent.setup()
  render(
    <PolicyForm
      disabled
      values={{
        user_agent_restriction_enabled: true,
        user_agent_profile: 'custom',
      }}
      onSave={vi.fn()}
    />
  )
  expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('switch'))
  expect(screen.getByRole('switch')).toBeChecked()
  expect(screen.getByRole('combobox')).toBeDisabled()
  for (const field of screen.getAllByRole('textbox')) {
    expect(field).toBeDisabled()
  }
})

test.each([
  {
    name: 'over 20 rules',
    user_agent_exact: Array.from({ length: 21 }, (_, i) => `Client/${i}`).join(
      '\n'
    ),
  },
  { name: 'oversized multibyte value', user_agent_exact: '测'.repeat(342) },
  { name: 'control character', user_agent_exact: 'Client/\u0000' },
])('$name fails validation and marks request settings invalid', (input) => {
  const values = {
    ...CHANNEL_FORM_DEFAULT_VALUES,
    name: 'Test',
    key: 'test',
    models: 'm',
    user_agent_restriction_enabled: true,
    user_agent_profile: 'custom' as const,
    user_agent_exact: input.user_agent_exact,
  }
  const result = channelFormSchema.safeParse(values)
  expect(result.success).toBe(false)
  const state = getChannelConfigurationState(
    values,
    { user_agent_exact: { type: 'custom', message: 'Invalid' } },
    true
  )
  expect(state.blocks.requestProcessing).toBe('error')
})

test('existing channel rules round-trip through the editor and mark request settings configured', () => {
  const policy = {
    enabled: true,
    profile: 'custom',
    rules: [
      { match: 'exact', value: 'MyTool/1.0' },
      { match: 'prefix', value: 'MyAgent/' },
    ],
  }
  const channel = channelSchema.parse({
    id: 1,
    name: 'Test',
    key: '',
    type: 1,
    status: 1,
    created_time: 0,
    test_time: 0,
    response_time: 0,
    balance_updated_time: 0,
    setting: JSON.stringify({ user_agent_policy: policy }),
  })
  const values = transformChannelToFormDefaults(channel)
  expect(JSON.parse(buildSettingJSON(values)).user_agent_policy).toEqual(policy)
  expect(
    getChannelConfigurationState(values, {}, true).blocks.requestProcessing
  ).toBe('configured')
})
