import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DraftSnapshot } from '../contract/draft-editor.ts'
import type { PendingComposerSend } from '../contract/composer-submission.ts'
import { parseStoredDraft } from '../draft.ts'
import { readConversationDraft } from '../stores.ts'

const empty: DraftSnapshot = { text: '', references: [] }

/** A Session's latest draft is shared. A tab retains its own in-flight admission across navigation. */
export class ComposerDraftStorage {
  private readonly key: string
  private version = 'initial'

  constructor(private readonly sessionId: SessionId) {
    this.key = `dsh.composer.${sessionId}`
  }

  read(): DraftSnapshot {
    try {
      const current = localStorage.getItem(this.key)
      this.version = current ?? 'initial'
      const localRequest = sessionStorage.getItem(this.key)
      const doc = this.documentKey(this.version)
      for (const request of [localRequest, localStorage.getItem(doc + '.request')]) {
        if (request === null) continue
        const raw = localStorage.getItem(this.requestKey(request))
        if (raw !== null) {
          const saved = JSON.parse(raw)
          const draft = parseStoredDraft(saved.draft)
          if (typeof saved.version === 'string' && draft?.pendingSend?.requestId === request) {
            this.version = saved.version
            return draft
          }
        }
        if (request === localRequest) sessionStorage.removeItem(this.key)
      }
      const value = localStorage.getItem(doc)
      if (value !== null) return parseStoredDraft(JSON.parse(value)) ?? empty
      return current === null ? readConversationDraft(this.sessionId) : empty
    } catch {
      return readConversationDraft(this.sessionId)
    }
  }

  /** Publish a new revision; an acceptance may only remove the version it actually submitted. */
  edit(draft: DraftSnapshot): void {
    try {
      const previous = localStorage.getItem(this.key)
      const version = randomUUID()
      localStorage.setItem(this.documentKey(version), JSON.stringify(draft))
      localStorage.setItem(this.key, version)
      this.version = version
      this.removeDocument(previous ?? 'initial')
    } catch { /* Draft editing remains available if browser storage is full. */ }
  }

  /** Persist the complete frozen request before dispatch, including when the view has unmounted. */
  save(draft: DraftSnapshot, pendingSend: PendingComposerSend): void {
    const request = pendingSend.requestId
    localStorage.setItem(this.requestKey(request), JSON.stringify({ version: this.version, draft: { ...draft, pendingSend } }))
    sessionStorage.setItem(this.key, request)
    // A fresh window can recover the latest shared draft even after its original tab closed.
    const current = localStorage.getItem(this.key)
    if (pendingSend.ownsDraft && this.version === (current ?? 'initial')) {
      if (current === null) localStorage.setItem(this.documentKey(this.version), JSON.stringify(draft))
      localStorage.setItem(this.documentKey(this.version) + '.request', request)
    }
  }

  /** Clear the frozen identity and retire only the accepted, immutable document version. */
  settle(record: PendingComposerSend, clear: boolean): void {
    try {
      if (clear) {
        if (this.version === 'initial') localStorage.setItem(this.documentKey(this.version), JSON.stringify(empty))
        else localStorage.removeItem(this.documentKey(this.version))
      }
      const link = this.documentKey(this.version) + '.request'
      if (localStorage.getItem(link) === record.requestId) localStorage.removeItem(link)
      localStorage.removeItem(this.requestKey(record.requestId))
      if (sessionStorage.getItem(this.key) === record.requestId) sessionStorage.removeItem(this.key)
    } catch { /* A retained record can still reconcile against exact Host evidence on reload. */ }
  }

  private documentKey(version: string): string { return `${this.key}.draft.${version}` }
  private requestKey(request: string): string { return `${this.key}.send.${request}` }

  private removeDocument(version: string): void {
    const key = this.documentKey(version)
    localStorage.removeItem(key)
    localStorage.removeItem(key + '.request')
  }
}
