import type { EvalConfig, EvalSuite, RunRecord, SettingsObservation, TaskFrequencies, Usage } from './types.js';
import { validateRunRecords } from './suite.js';
import { formatTokens, summarizeUsage, TOKEN_FIELDS, usageParts, type UsageSummary } from './usage.js';

export interface ConfigSummary {
  configId: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  difficult: number;
  retries: number;
  /** null when any record is missing latency. */
  totalLatencyMs: number | null;
  /** null when any record is missing usage attribution; never silently zero. */
  totalUsage: Usage | null;
  usageAttributionComplete: boolean;
  usageBreakdown: UsageSummary;
  /** Operator effort stays separate so model savings cannot hide human work. */
  totalOperatorMinutes: number | null;
  operatorAttributionComplete: boolean;
}

export function summarize(records: RunRecord[], configId: string): ConfigSummary {
  validateRunRecords(records);
  const rows = records.filter((record) => record.configId === configId);
  let latency: number | null = 0;
  const parts = rows.flatMap(usageParts);
  const usageBreakdown = summarizeUsage(parts);
  const { inputTokens, outputTokens } = usageBreakdown;
  const usage: Usage | null = inputTokens.complete && outputTokens.complete
    ? { inputTokens: inputTokens.known!, outputTokens: outputTokens.known! } : null;
  let operator: number | null = 0;
  for (const row of rows) {
    if (row.latencyMs === null) latency = null;
    else if (latency !== null) latency += row.latencyMs;
    if (row.operatorMinutes === null) operator = null;
    else if (operator !== null) operator += row.operatorMinutes;
  }
  return {
    configId,
    total: rows.length,
    passed: rows.filter((row) => row.outcome === 'pass').length,
    failed: rows.filter((row) => row.outcome === 'fail').length,
    errored: rows.filter((row) => row.outcome === 'error').length,
    difficult: rows.filter((row) => row.difficult).length,
    retries: rows.reduce((sum, row) => sum + row.retries, 0),
    totalLatencyMs: latency,
    totalUsage: usage,
    usageAttributionComplete: TOKEN_FIELDS.every((field) => usageBreakdown[field].complete)
      && parts.every((part) => Boolean(part?.source) && part?.source !== 'unknown'),
    usageBreakdown,
    totalOperatorMinutes: operator,
    operatorAttributionComplete: operator !== null,
  };
}

export interface WeightedResult {
  configId: string;
  weightedPassRate: number;
}

/**
 * Workload-weighted results are only produced when every evaluated fixture has
 * a documented frequency. Otherwise callers must report per-task results and
 * make no representative-savings claim.
 */
export function weightedPassRates(
  suite: EvalSuite,
  records: RunRecord[],
  frequencies: TaskFrequencies | null,
): WeightedResult[] | null {
  validateRunRecords(records, suite);
  if (!frequencies) return null;
  const known = new Set(suite.fixtures.map((fixture) => fixture.id));
  if (Object.keys(frequencies).some((id) => !known.has(id))) return null;
  const evaluated = [...new Set(records.map((record) => record.fixtureId))];
  if (evaluated.some((id) => !Number.isFinite(frequencies[id]) || frequencies[id] < 0)) return null;
  const totalWeight = evaluated.reduce((sum, id) => sum + frequencies[id], 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  const configIds = [...new Set(records.map((record) => record.configId))];
  return configIds.map((configId) => {
    const weighted = records
      .filter((record) => record.configId === configId && record.outcome === 'pass')
      .reduce((sum, record) => sum + frequencies[record.fixtureId], 0);
    return { configId, weightedPassRate: weighted / totalWeight };
  });
}

function num(value: number | null): string {
  return value === null ? 'unknown' : String(value);
}

function tableRow(cells: (string | number)[]): string {
  return `| ${cells.map((cell) => String(cell).replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '&#124;')
    .replace(/[\r\n]+/g, ' ')).join(' | ')} |`;
}

function settings(value: SettingsObservation | undefined): string {
  return value ? `${value.model ?? 'unknown'} / ${value.reasoningEffort ?? 'unknown'} (${value.source})` : 'unknown';
}

function responseStatus(record: RunRecord): string {
  return record.checks.length === 0 ? 'unknown' : record.checks.every((check) => check.passed) ? 'pass' : 'fail';
}

function requiredStatus(record: RunRecord): string {
  return record.requiredChecksPassed === null ? 'unknown' : record.requiredChecksPassed ? 'pass' : 'fail';
}

function configTable(configs: EvalConfig[], surfaces: string[]): string {
  const header = `| config | baseline | omx revision | service tier | cache | ${surfaces.join(' | ')} |`;
  const divider = `| --- | --- | --- | --- | --- | ${surfaces.map(() => '---').join(' | ')} |`;
  const rows = configs.map((config) => {
    const cells = surfaces.map((surface) => {
      const role = config.roles[surface];
      return role ? `${role.model} / ${role.reasoningEffort}` : 'unknown';
    });
    return tableRow([config.id, config.isBaseline ? 'yes' : 'no', config.omxRevision, config.serviceTier, config.cacheConditions, ...cells]);
  });
  return [header, divider, ...rows].join('\n');
}

export function renderReport(
  suite: EvalSuite,
  records: RunRecord[],
  frequencies: TaskFrequencies | null = null,
  evidence?: 'synthetic' | 'observed',
): string {
  validateRunRecords(records, suite);
  const surfaces = [...new Set(suite.fixtures.map((fixture) => fixture.surface))];
  const configIds = [...new Set(records.map((record) => record.configId))];
  const summaries = configIds.map((configId) => summarize(records, configId));
  const lines: string[] = [];

  lines.push('# OMX default-model evaluation report');
  lines.push('');
  lines.push(evidence === 'synthetic'
    ? '**Synthetic supplied observations — accounting examples, not measured model results.**'
    : evidence === 'observed' ? 'Supplied observations; the report does not independently verify their provenance.'
      : 'Evidence origin: unspecified (legacy records).');
  lines.push('');
  lines.push('## Configurations');
  lines.push(configTable(suite.configs, surfaces));
  lines.push('Role pins above are configuration values; they do not prove runtime settings.');
  lines.push('');

  lines.push('## Stage settings');
  lines.push('| fixture / workflow | config / stage | surface / role | requested model / effort | override source (model / effort) | launch-resolved (source) | runtime-observed (source) |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');
  for (const record of records) {
    const config = suite.configs.find((entry) => entry.id === record.configId);
    if (!record.stages) {
      lines.push(tableRow([`${record.fixtureId} / ${record.workflowId ?? 'unknown'}`, `${record.configId} / unknown`, 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']));
    }
    for (const stage of config?.stages ?? []) {
      const observed = record.stages?.find((entry) => entry.stageId === stage.id);
      lines.push(tableRow([`${record.fixtureId} / ${record.workflowId}`, `${record.configId} / ${stage.id}`,
        `${stage.surface} / ${stage.role}`, `${stage.requested.model} / ${stage.requested.reasoningEffort}`,
        `${stage.overrideSource.model} / ${stage.overrideSource.reasoningEffort}`,
        settings(observed?.launchResolved), settings(observed?.runtimeObserved)]));
    }
  }
  lines.push('');

  lines.push('## Per-task results');
  lines.push(
    '| fixture | config | declared outcome | failed response checks | retries | workflow elapsed ms | input/output | operator min | response grade | required checks |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const record of records) {
    const failed = record.checks.filter((check) => !check.passed).map((check) => check.name);
    const tokens = summarizeUsage(usageParts(record));
    const usage = `${formatTokens(tokens.inputTokens)}/${formatTokens(tokens.outputTokens)}`;
    lines.push(tableRow([record.fixtureId, record.configId, record.outcome, failed.join(', ') || '—',
      record.retries, num(record.latencyMs), usage, num(record.operatorMinutes), responseStatus(record), requiredStatus(record)]));
  }
  lines.push('');

  lines.push('## Aggregate per configuration');
  lines.push(
    '| config | declared pass | fail | error | difficult | retries | sum workflow elapsed ms | input/output | operator min |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const summary of summaries) {
    const usage = summary.totalUsage
      ? `${summary.totalUsage.inputTokens}/${summary.totalUsage.outputTokens}`
      : 'unknown';
    lines.push(tableRow([summary.configId, summary.passed, summary.failed, summary.errored, summary.difficult,
      summary.retries, num(summary.totalLatencyMs), usage, num(summary.totalOperatorMinutes)]));
  }
  lines.push('');

  lines.push('## Usage observations');
  lines.push('Input/output are inclusive totals. Uncached input and cache reads partition input; cache writes are separate observations, never added to input. Reasoning is already in output.');
  lines.push('| scope | input | output | uncached input | cache read | cache write | source | stage duration ms |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const record of records) {
    const scope = `${record.fixtureId} @ ${record.configId}`;
    if (record.usageScope !== 'stages') {
      const usage = summarizeUsage([record.usage]);
      lines.push(tableRow([`${scope}: workflow (canonical)`, ...TOKEN_FIELDS.map((field) => formatTokens(usage[field])),
        record.usage?.source ?? 'unknown', 'not-applicable']));
    }
    for (const stage of record.stages ?? []) {
      const usage = summarizeUsage([stage.usage]);
      lines.push(tableRow([`${scope}: ${stage.stageId} (${record.usageScope === 'stages' ? 'canonical' : 'detail only'})`,
        ...TOKEN_FIELDS.map((field) => formatTokens(usage[field])), stage.usage?.source ?? 'unknown', num(stage.latencyMs)]));
    }
  }
  for (const summary of summaries) {
    lines.push(tableRow([`${summary.configId}: aggregate canonical usage`,
      ...TOKEN_FIELDS.map((field) => formatTokens(summary.usageBreakdown[field])), 'supplied records above', 'not-applicable']));
  }
  lines.push('Stage rows are not task outcomes. Stage durations are not workflow wall time; operator time is separate. Known sums exclude missing measurements.');
  lines.push('');

  const failures = records.filter((record) => record.outcome !== 'pass' || record.difficult
    || responseStatus(record) !== 'pass' || record.requiredChecksPassed !== true);
  lines.push('## Failed and difficult cases (including unverified checks)');
  if (failures.length === 0) lines.push('None recorded.');
  for (const record of failures) {
    const failed = record.checks.filter((check) => !check.passed);
    lines.push(
      `- \`${record.fixtureId}\` @ \`${record.configId}\`: ${record.outcome}${record.difficult ? ' (difficult)' : ''}` +
        (failed.length
          ? ` — ${failed.map((check) => `${check.name}: ${check.detail ?? 'failed'}`).join('; ')}`
          : ''),
    );
    if (record.requiredChecksPassed !== true) lines.push(`  Required checks: ${requiredStatus(record)}; declared outcome is not verified completion.`);
  }
  lines.push('');

  lines.push('## Cost claims');
  const incomplete = summaries.filter((summary) => !summary.usageAttributionComplete);
  if (incomplete.length > 0) {
    lines.push(
      `Usage attribution is incomplete for: ${incomplete.map((summary) => summary.configId).join(', ')}. No complete cost claim is made for those configurations.`,
    );
  } else if (summaries.length > 0) {
    lines.push('All required token categories have supplied attribution; this is not a billing or savings result.');
  } else {
    lines.push('No workflow observations supplied.');
  }
  const operatorIncomplete = summaries.filter((summary) => !summary.operatorAttributionComplete);
  if (operatorIncomplete.length > 0) {
    lines.push(
      `Operator effort is unknown for: ${operatorIncomplete.map((summary) => summary.configId).join(', ')}; reduced model usage cannot be read as reduced total effort.`,
    );
  }
  lines.push('A lower token count alone is not a successful result.');
  lines.push('Declared pass counts and rates do not certify executed checks, independent review, or accepted completion. No model quality, cost, or savings conclusion is established by this report.');
  lines.push('');

  lines.push('## Workload-weighted summary');
  const weighted = weightedPassRates(suite, records, frequencies);
  if (!weighted) {
    lines.push(
      'Not reported: documented, representative task frequencies are missing for at least one evaluated fixture. Per-task results above stand on their own and imply no representative savings.',
    );
  } else {
    for (const row of weighted) {
      lines.push(
        `- ${row.configId}: ${(row.weightedPassRate * 100).toFixed(1)}% weighted declared pass rate`,
      );
    }
  }
  lines.push('');

  lines.push('## Limitations');
  lines.push(
    '- Estimates (implementation/maintenance effort) are labeled separately from measurements.',
  );
  lines.push(
    '- Identical reasoning-effort labels across models do not establish equivalent quality or cost.',
  );
  lines.push(
    '- Codex-owned context, caching, and compaction behavior is not controlled by this suite; such fields are recorded as observed or `unknown`.',
  );
  return lines.join('\n');
}
