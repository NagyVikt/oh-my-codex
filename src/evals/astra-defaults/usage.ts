import { EvalSuiteError } from './suite.js';
import type { RunRecord, Usage } from './types.js';

export const TOKEN_FIELDS = [
  'inputTokens', 'outputTokens', 'uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens',
] as const;
export type TokenField = typeof TOKEN_FIELDS[number];

export interface TokenSummary {
  /** Sum of available measurements, not an estimate of missing observations. */
  known: number | null;
  complete: boolean;
  unknown: number;
  unsupported: number;
  notApplicable: number;
}

export type UsageSummary = Record<TokenField, TokenSummary>;

export function usageParts(record: RunRecord): (Usage | null)[] {
  return record.usageScope === 'stages'
    ? record.stages!.map((stage) => stage.usage)
    : [record.usage];
}

export function summarizeUsage(parts: (Usage | null)[]): UsageSummary {
  return Object.fromEntries(TOKEN_FIELDS.map((field) => {
    let known: number | null = null;
    let unknown = 0;
    let unsupported = 0;
    let notApplicable = 0;
    for (const part of parts) {
      const value = part?.[field];
      if (typeof value === 'number') {
        known = (known ?? 0) + value;
        if (!Number.isSafeInteger(known)) throw new EvalSuiteError(`unsafe aggregate ${field}`);
      } else if (value === 'not-applicable') notApplicable++;
      else if (value === 'unsupported') unsupported++;
      else unknown++;
    }
    return [field, { known, unknown, unsupported, notApplicable,
      complete: parts.length > 0 && unknown === 0 && unsupported === 0 }];
  })) as UsageSummary;
}

export function formatTokens(summary: TokenSummary): string {
  const states = [
    summary.unknown ? `${summary.unknown} unknown` : '',
    summary.unsupported ? `${summary.unsupported} unsupported` : '',
    summary.notApplicable ? `${summary.notApplicable} not-applicable` : '',
  ].filter(Boolean);
  if (summary.known === null) return states.join(', ') || 'unknown';
  return `${summary.known}${states.length ? ` known; ${states.join(', ')}` : ''}`;
}
