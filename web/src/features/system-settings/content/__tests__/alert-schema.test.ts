import { expect, test } from 'vitest'

import { alertFormSchema, EMPTY_ALERT_FORM } from '../alert-schema'

const valid = { ...EMPTY_ALERT_FORM, content: 'Maintenance tonight' }

function issuesFor(values: Record<string, unknown>) {
  const result = alertFormSchema.safeParse(values)
  if (result.success) return []
  return result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }))
}

test('an alert without a schedule passes validation', () => {
  expect(issuesFor(valid)).toEqual([])
})

test('an alert with only one schedule bound passes validation', () => {
  expect(issuesFor({ ...valid, startsAt: '2026-11-07T20:00:00.000Z' })).toEqual(
    []
  )
  expect(issuesFor({ ...valid, endsAt: '2026-11-07T20:00:00.000Z' })).toEqual(
    []
  )
})

test('blank content is rejected on the content field', () => {
  expect(issuesFor({ ...valid, content: '   ' })).toEqual([
    { path: 'content', message: 'Content is required' },
  ])
})

test('content longer than 500 characters is rejected', () => {
  expect(issuesFor({ ...valid, content: 'a'.repeat(501) })).toEqual([
    { path: 'content', message: 'Content must be at most 500 characters' },
  ])
})

test('a title longer than 100 characters is rejected', () => {
  expect(issuesFor({ ...valid, title: 'a'.repeat(101) })).toEqual([
    { path: 'title', message: 'Title must be at most 100 characters' },
  ])
})

test('an end time equal to the start time is rejected on the end field', () => {
  expect(
    issuesFor({
      ...valid,
      startsAt: '2026-11-07T20:00:00.000Z',
      endsAt: '2026-11-07T20:00:00.000Z',
    })
  ).toEqual([{ path: 'endsAt', message: 'End time must be after start time' }])
})

test('an end time before the start time is rejected on the end field', () => {
  expect(
    issuesFor({
      ...valid,
      startsAt: '2026-11-07T20:00:00.000Z',
      endsAt: '2026-11-07T19:00:00.000Z',
    })
  ).toEqual([{ path: 'endsAt', message: 'End time must be after start time' }])
})
