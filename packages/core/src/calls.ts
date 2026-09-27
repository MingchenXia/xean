import type { JsonValue } from "@earendil-works/chord";

/** Runtime credentials and headers are deliberately absent. */
export interface CallIdentity {
  provider: string;
  id: string;
  api: string;
}

export interface RecordedCall {
  /** Persist the effective request snapshot before dispatch. */
  recordRequest(payload: JsonValue): void | Promise<void>;
  /**
   * Preserve the backend's native, JSON-serializable result and usage shapes.
   * Null usage means no measurement. Reported counts can be partial on failure;
   * they are not a reconciliation of the provider's final bill.
   * Every admitted call must settle, including when recordRequest() fails.
   */
  settle(message: unknown, usage: unknown | null): void | Promise<void>;
}

export interface CallRecorder {
  /**
   * Admit one logical call before dispatch. Backend-internal requests are opaque.
   * Every successful begin must eventually settle so cooperative shutdown can
   * join it; the backend adapter owns this obligation.
   */
  begin(identity: CallIdentity): RecordedCall | Promise<RecordedCall>;
}
