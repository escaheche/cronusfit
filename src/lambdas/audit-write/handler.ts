/**
 * Audit Write Lambda Handler
 *
 * Processes batches of audit log entries with retry logic.
 * Can be invoked directly by other Lambdas or via SNS/SQS for
 * asynchronous/queued audit writes.
 *
 * Input: { entries: AuditEntryInput[] }
 * Output: { success: boolean; written: number; failed: number; errors?: string[] }
 *
 * Uses `recordAuditEntryStrict` which retries up to 5 times with exponential
 * backoff per entry before reporting failure.
 *
 * @module lambdas/audit-write
 * @requirements 13.5
 */

import type { Handler } from 'aws-lambda';
import {
  recordAuditEntryStrict,
  type AuditEntryInput,
} from '../../modules/security/audit-log.js';

/** Input payload for the audit-write Lambda. */
interface AuditWriteEvent {
  entries: AuditEntryInput[];
}

/** Response payload from the audit-write Lambda. */
interface AuditWriteResponse {
  success: boolean;
  written: number;
  failed: number;
  errors?: string[];
}

/**
 * Lambda handler for batch audit log writes.
 *
 * Processes each entry independently — a failure in one entry does not
 * prevent other entries from being written. Returns a summary of
 * successes and failures.
 */
export const handler: Handler<AuditWriteEvent, AuditWriteResponse> = async (event) => {
  const { entries } = event;

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    return { success: true, written: 0, failed: 0 };
  }

  let written = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const entry of entries) {
    try {
      await recordAuditEntryStrict(entry);
      written++;
    } catch (error: unknown) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`[${entry.actionType}/${entry.resourceId}]: ${message}`);
    }
  }

  return {
    success: failed === 0,
    written,
    failed,
    ...(errors.length > 0 ? { errors } : {}),
  };
};
