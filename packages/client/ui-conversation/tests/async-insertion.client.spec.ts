/** Late input insertions preserve references, subsequent edits, and undo ownership. */
import { Context } from '@deepseek-ai/cordis'
import { REDO_COMMAND, UNDO_COMMAND } from 'lexical'
import { expect, it, vi } from 'vitest'
import { SessionInputShell } from '../src/client/input/facade.ts'

function shell(): SessionInputShell {
  return new SessionInputShell({ actx: new Context(), defaultSink: vi.fn(), commandAttachments: {
    serialize: async () => [], release: () => {}, unsupportedNotice: () => '',
  } })
}

it('inserts text beside an existing reference and undoes only that insertion', async () => {
  const input = shell()
  try {
    input.setDraft('@ref')
    input.insertReference({ source: 'file', ref: 'src/main.ts', label: 'main.ts', clipboardText: '@[main.ts](src/main.ts)' },
      { start: 0, end: 4, draftRev: input.state.getSnapshot().draftRev })
    const original = input.state.getSnapshot()
    expect(input.actions.insertText(' check types', input.actions.captureInsertion())).toBe(true)
    expect(input.state.getSnapshot().draft).toContain('check types')
    expect(input.state.getSnapshot().occurrences).toEqual(original.occurrences)
    input.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => { expect(input.state.getSnapshot().draft).toBe(original.draft) })
  } finally { input.dispose() }
})

it('refuses results captured before a user edit or after editor disposal', () => {
  const input = shell()
  input.setDraft('before')
  const span = input.actions.captureInsertion()
  input.setDraft('my newer text')
  expect(input.actions.insertText('late voice', span)).toBe(false)
  expect(input.state.getSnapshot().draft).toBe('my newer text')
  const latest = input.actions.captureInsertion()
  input.dispose()
  expect(input.actions.insertText('late voice', latest)).toBe(false)
})

it('restores the source of an identical replacement through native undo and redo', async () => {
  const input = shell()
  try {
    const token = {}
    const { actions } = input
    actions.insertText('hello', actions.captureInsertion(), { token, start: 0, end: 5 })
    expect(actions.getInsertionOrigins?.()).toEqual([token])
    actions.insertText('hello', { ...actions.captureInsertion(), start: 0, end: 5 })
    expect(input.snapshot.draft).toBe('hello')
    expect(actions.getInsertionOrigins?.()).toEqual([])
    input.editor.dispatchCommand(UNDO_COMMAND, undefined)
    await vi.waitFor(() => { expect(actions.getInsertionOrigins?.()).toEqual([token]) })
    expect(input.snapshot.draft).toBe('hello')
    input.editor.dispatchCommand(REDO_COMMAND, undefined)
    await vi.waitFor(() => { expect(actions.getInsertionOrigins?.()).toEqual([]) })
    expect(input.snapshot.draft).toBe('hello')
  } finally { input.dispose() }
})
