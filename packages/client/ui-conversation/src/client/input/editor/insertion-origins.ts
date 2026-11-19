import {
  $addUpdateTag, $createRangeSelection, $getRoot, $getSelection, $getState, $hasUpdateTag, $isRangeSelection,
  $setState, BEFORE_INPUT_COMMAND, COMMAND_PRIORITY_CRITICAL, CONTROLLED_TEXT_INSERTION_COMMAND,
  createState, CUT_COMMAND, DELETE_CHARACTER_COMMAND, DELETE_WORD_COMMAND, HISTORIC_TAG, RootNode,
  type LexicalEditor,
} from 'lexical'
import { mergeRegister } from '@lexical/utils'
import type { InsertionOrigin } from '../../contract/input.ts'
import { $composerLayout, $detectOffsetOfPoint } from './projection.ts'
import type { DetectSpan } from './span-map.ts'

const empty: readonly InsertionOrigin[] = []
// Root NodeState is part of Lexical history. The opaque tokens belong only to
// this editor lifetime and must never enter a serialized draft or clipboard.
const origins = createState('dsh-input-origins', { parse: () => empty, unparse: () => undefined })
const tracked = 'dsh-origin-edit'

/** Preserve the untouched portions on both sides of an actual replacement range. */
function $splice(span: DetectSpan, size: number, origin?: InsertionOrigin): void {
  $addUpdateTag(tracked)
  const root = $getRoot()
  const current = $getState(root, origins)
  if (!current.length && !origin) return
  const next: InsertionOrigin[] = []
  const shift = size - (span.end - span.start)
  for (const { start, end, token } of current) {
    if (start < span.start) next.push({ start, end: Math.min(end, span.start), token })
    if (end > span.end) next.push({ start: Math.max(start, span.end) + shift, end: end + shift, token })
  }
  if (origin && 0 <= origin.start && origin.start < origin.end && origin.end <= size) {
    next.push({ token: origin.token, start: span.start + origin.start, end: span.start + origin.end })
  }
  $setState(root, origins, next)
}

/** Session-local evidence for edits, retained by the editor's own undo steps. */
export class InsertionOrigins {
  private edit: { before: string; span: DetectSpan; backward: boolean } | undefined

  constructor(private readonly editor: LexicalEditor, private readonly previousText: () => string) {}

  tokens(): readonly object[] {
    return this.editor.getEditorState().read(() => $getState($getRoot(), origins).map(range => range.token))
  }

  $replace = $splice

  $clear(): void {
    this.edit = undefined
    if ($getState($getRoot(), origins).length) $setState($getRoot(), origins, empty)
  }

  $capture(backward = false, range?: StaticRange): false {
    if (!$getState($getRoot(), origins).length) return false
    let selection = $getSelection()
    if (range !== undefined) {
      const target = $createRangeSelection()
      target.applyDOMRange(range)
      selection = target
    }
    if (!$isRangeSelection(selection)) return false
    const layout = $composerLayout()
    const anchor = $detectOffsetOfPoint(layout, selection.anchor)
    const focus = $detectOffsetOfPoint(layout, selection.focus)
    if (anchor === null || focus === null) return false
    const edit = { before: layout.detectText, span: { start: Math.min(anchor, focus), end: Math.max(anchor, focus) }, backward }
    this.edit = edit
    // A DOM beforeinput and its mutation may commit separately in this task.
    // A canceled gesture must never identify an unrelated later change.
    setTimeout(() => { if (this.edit === edit) this.edit = undefined }, 0)
    return false
  }

  register(): () => void {
    const e = this.editor
    return mergeRegister(
      e.registerCommand(BEFORE_INPUT_COMMAND, event => {
        if (!/^(insert|delete)/.test(event.inputType)) return false
        return this.$capture(event.inputType.endsWith('Backward'), event.getTargetRanges()[0])
      }, COMMAND_PRIORITY_CRITICAL),
      e.registerCommand(CONTROLLED_TEXT_INSERTION_COMMAND, event => {
        if (this.edit === undefined) this.$capture()
        // An identical replacement may change only the selection. Make this
        // provenance change part of the very same native undo operation.
        const edit = this.edit
        const text = typeof event === 'string' ? event : event.data
        if (edit && text && edit.span.start < edit.span.end && edit.before.slice(edit.span.start, edit.span.end) === text) {
          $splice(edit.span, text.length)
          this.edit = undefined
        }
        return false
      }, COMMAND_PRIORITY_CRITICAL),
      e.registerCommand(DELETE_CHARACTER_COMMAND, backward => this.edit ? false : this.$capture(backward), COMMAND_PRIORITY_CRITICAL),
      e.registerCommand(DELETE_WORD_COMMAND, backward => this.edit ? false : this.$capture(backward), COMMAND_PRIORITY_CRITICAL),
      e.registerCommand(CUT_COMMAND, () => this.$capture(), COMMAND_PRIORITY_CRITICAL),
      e.registerNodeTransform(RootNode, () => {
        if ($hasUpdateTag(tracked) || $hasUpdateTag(HISTORIC_TAG) || !$getState($getRoot(), origins).length) return
        const before = this.previousText()
        const after = $composerLayout().detectText
        if (before === after) return
        const edit = this.edit
        this.edit = undefined
        if (edit?.before === before) {
          let { start, end } = edit.span
          const delta = after.length - before.length
          if (start === end && delta < 0) {
            if (edit.backward) start += delta
            else end -= delta
          }
          const size = end - start + delta
          if (start >= 0 && end <= before.length && size >= 0
            && after.slice(0, start) === before.slice(0, start)
            && after.slice(start + size) === before.slice(end)) {
            $splice({ start, end }, size)
            return
          }
        }
        this.$clear()
      }),
    )
  }
}
