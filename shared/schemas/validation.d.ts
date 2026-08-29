// Type declarations for validation.js.

import type { ClientMessage, ClientMessageType, ErrorCode } from './messages';

export interface ValidationSuccess<T = ClientMessage> {
  ok: true;
  message: T;
}

export interface ValidationFailure {
  ok: false;
  /** One of messages.js ERROR_CODES — the same vocabulary message-router.js already emits. */
  error: ErrorCode;
  /** Human-readable reason, safe to log and to echo back in `ErrorMessage.detail`. */
  detail?: string;
}

export type ValidationResult<T = ClientMessage> = ValidationSuccess<T> | ValidationFailure;

export type MessageValidator = (message: Record<string, unknown>) => ValidationResult;

/** One validator per client-to-server message type, keyed by `type`. */
export declare const CLIENT_MESSAGE_VALIDATORS: Readonly<
  Record<ClientMessageType, MessageValidator>
>;

export interface ValidateOptions {
  /**
   * When true (the default), a declared-but-unimplemented type fails with `not_implemented`
   * before its payload is inspected — design Decision 7. Set false for a client-side pre-send
   * shape check of a type whose server handler does not exist yet.
   */
  requireImplemented?: boolean;
}

/**
 * Validates an already-parsed inbound message. Never throws; returns a discriminated result.
 * Checks shape only — authority checks (affordability, reach, dish existence) belong to
 * server/src/game/validators/.
 */
export declare function validateClientMessage(
  message: unknown,
  options?: ValidateOptions,
): ValidationResult;
