/** Composer submission vocabulary shared by the input and settings domains. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller/types'
import type { BusyEnterBehavior } from '../../submission-settings.ts'

export type { BusyEnterBehavior } from '../../submission-settings.ts'

/** Delivery mode requested for one ordinary composer message. */
export type InputSubmitMode = BusyEnterBehavior

/** Keyboard gesture whose delivery mode the submission policy resolves. */
export type ComposerSubmitGesture = 'enter' | 'accelerated'

/**
 * Frozen wire intent stored with the ordinary Session draft until admission is known.
 * Files use their original upload receipts, so a retry never re-uploads them.
 */
export interface PendingComposerSend {
  readonly requestId: SessionRequestId
  readonly afterSeq: number
  readonly mode: InputSubmitMode
  readonly content: import('@deepseek-ai/dsh-api-session-controller/types').PromptContentPart[]
  readonly attachmentNames: readonly string[]
  readonly ownsDraft: boolean
}

/** Draft owner's persistence and explicit-retry controls for one admission. */
export interface ComposerSendRecovery {
  readonly restored?: PendingComposerSend
  save(record: PendingComposerSend): void
  offerRetry(retry?: () => void): void
}

/** Host admission of one ordinary composer draft addressed by Session and request identity. */
export interface InputSubmission {
  /** Owning Session. */
  readonly sessionId: SessionId
  /** The prompt request id echoed by native Inbox and user message events. */
  readonly requestId: SessionRequestId
  /** InputState.draftRev captured when the composer froze this draft. */
  readonly draftRevision: number
  /** Pending precedes the call. Unresolved may later settle as accepted from native evidence. */
  readonly status: 'pending' | 'accepted' | 'rejected' | 'canceled' | 'unresolved'
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Notify a live ordinary prompt admission. Claimed slash commands and empty continuation retries are excluded.
     * @param submission - native request identity, frozen revision, and current admission status.
     * @mode emit
     */
    'conversation/input/submission'(submission: InputSubmission): void
  }
}

/** Session facts captured when a message submission starts, before asynchronous command arbitration. */
export interface MessageSubmissionState {
  readonly sessionId?: import('@deepseek-ai/dsh-session/types').SessionId
  readonly model?: { readonly provider: string; readonly name: string; readonly effort?: string }
  readonly runMode: 'default' | 'plan' | 'goal'
  readonly running: boolean
  /** Whether the Session is still blank, so this message is its first. */
  readonly newSession: boolean
  /** Agent preset id the Session records, when known. */
  readonly agentPreset?: string
}

/** Immutable occurrence and delivery intent carried by one composer attempt. */
export interface MessageSubmission {
  readonly timestamp: number
  readonly draftRevision: number
  readonly source?: 'click' | 'enter'
  readonly mode: InputSubmitMode
  readonly state?: MessageSubmissionState
}
