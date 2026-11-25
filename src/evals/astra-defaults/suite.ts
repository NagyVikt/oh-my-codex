import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type {
  CheckResult,
  EvalConfig,
  EvalFixture,
  EvalSuite,
  QualityCheck,
  RunRecord,
  SuppliedRecords,
} from './types.js';

export class EvalSuiteError extends Error {}

const text = z.string().refine((value) => value.trim().length > 0, 'must be nonempty');
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const duration = z.number().nonnegative().finite().nullable();
const pair = z.object({ model: text, reasoningEffort: text }).strict();
const stageConfig = z.object({
  id: text,
  role: text,
  surface: z.enum(['main', 'native-agent', 'team-worker', 'sparkshell']),
  requested: pair,
  overrideSource: pair,
}).strict();
const observation = z.object({
  model: text.nullable(), reasoningEffort: text.nullable(), source: text,
}).strict();
const tokenObservation = z.union([tokens, z.enum(['unsupported', 'not-applicable'])]).nullable();
const usage = z.object({
  inputTokens: tokens,
  outputTokens: tokens,
  uncachedInputTokens: tokenObservation.optional(),
  cacheReadTokens: tokenObservation.optional(),
  cacheWriteTokens: tokenObservation.optional(),
  source: text.optional(),
}).strict().superRefine((value, ctx) => {
  const parts = [value.uncachedInputTokens, value.cacheReadTokens, value.cacheWriteTokens];
  if (parts.some((part) => part !== undefined && part !== null) && !value.source) {
    ctx.addIssue({ code: 'custom', message: 'usage breakdown requires a source' });
  }
  // Reads and uncached input partition inclusive input. Writes are separately
  // observed provider metadata; they are not added to either input or reads.
  const knownInput = [value.uncachedInputTokens, value.cacheReadTokens]
    .reduce<number>((sum, part) => sum + (typeof part === 'number' ? part : 0), 0);
  if (knownInput > value.inputTokens) {
    ctx.addIssue({ code: 'custom', message: 'input subsets exceed inputTokens' });
  }
  if ([value.uncachedInputTokens, value.cacheReadTokens].every((part) =>
    typeof part === 'number' || part === 'not-applicable')
      && knownInput !== value.inputTokens) {
    ctx.addIssue({ code: 'custom', message: 'uncached input plus cache reads must equal inputTokens' });
  }
});
const runRecord = z.object({
  fixtureId: text, configId: text,
  outcome: z.enum(['pass', 'fail', 'error']),
  checks: z.array(z.object({
    name: text, kind: z.enum(['must-include', 'must-not-include', 'exact-set']),
    passed: z.boolean(), detail: z.string().optional(),
  }).strict()),
  requiredChecksPassed: z.boolean().nullable(),
  retries: tokens, latencyMs: duration, usage: usage.nullable(), operatorMinutes: duration,
  difficult: z.boolean(), notes: z.string().optional(),
  workflowId: text.optional(), usageScope: z.enum(['workflow', 'stages']).optional(),
  stages: z.array(z.object({
    stageId: text, launchResolved: observation.optional(), runtimeObserved: observation.optional(),
    usage: usage.nullable(), latencyMs: duration,
  }).strict()).min(1).optional(),
}).strict();

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new EvalSuiteError(`${label}: ${result.error.message}`);
  return result.data;
}

/** Shared import/report boundary. Repeated trials are deliberately unsupported. */
export function validateRunRecords(records: unknown, suite?: EvalSuite): RunRecord[] {
  const rows = parse(z.array(runRecord), records, 'invalid run records');
  const seen = new Set<string>();
  const workflows = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.fixtureId, row.configId]);
    if (seen.has(key)) throw new EvalSuiteError(`duplicate fixture/config record ${key}; repeated trials unsupported`);
    seen.add(key);
    if (row.workflowId) {
      const workflow = JSON.stringify([row.configId, row.workflowId]);
      if (workflows.has(workflow)) throw new EvalSuiteError(`duplicate workflow ${workflow}`);
      workflows.add(workflow);
    }
    if (row.stages) {
      if (!row.workflowId || !row.usageScope) throw new EvalSuiteError(`${key}: stages require workflowId and usageScope`);
      if (new Set(row.stages.map((stage) => stage.stageId)).size !== row.stages.length) {
        throw new EvalSuiteError(`${key}: duplicate stage id`);
      }
      if (row.usageScope === 'stages' && row.usage !== null) {
        throw new EvalSuiteError(`${key}: stage accounting requires workflow usage to be null`);
      }
    } else if (row.usageScope === 'stages') {
      throw new EvalSuiteError(`${key}: stage accounting requires stages`);
    }
    if (!suite) continue;
    const fixture = suite.fixtures.find((entry) => entry.id === row.fixtureId);
    const config = suite.configs.find((entry) => entry.id === row.configId);
    if (!fixture || (!config && row.configId !== 'deterministic-no-model')) {
      throw new EvalSuiteError(`${key}: unknown fixture or config`);
    }
    if (!config && (!fixture.deterministicBaseline || row.stages)) {
      throw new EvalSuiteError(`${key}: invalid deterministic baseline record`);
    }
    if (fixture.checks.length !== row.checks.length || fixture.checks.some((check) =>
      row.checks.filter((result) => result.name === check.name && result.kind === check.kind).length !== 1)) {
      throw new EvalSuiteError(`${key}: response checks must match the fixture checks`);
    }
    const expected = config?.stages?.map((stage) => stage.id) ?? [];
    const actual = row.stages?.map((stage) => stage.stageId) ?? [];
    if (expected.length !== actual.length || expected.some((id) => !actual.includes(id))) {
      throw new EvalSuiteError(`${key}: stages must match configuration; use null observations for missing evidence`);
    }
  }
  return rows;
}

export function loadRunRecords(path: string, suite: EvalSuite): SuppliedRecords {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (error) {
    throw new EvalSuiteError(`invalid records JSON in ${path}: ${(error as Error).message}`);
  }
  const supplied = parse(z.object({
    evidence: z.enum(['synthetic', 'observed']), records: z.array(runRecord).min(1),
  }).strict(), value, 'invalid supplied records');
  return { ...supplied, records: validateRunRecords(supplied.records, suite) };
}

function readJsonDir<T>(dir: string): T[] {
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.endsWith('.json'));
  } catch {
    throw new EvalSuiteError(`missing suite directory: ${dir}`);
  }
  entries.sort();
  return entries.map((name) => {
    const path = join(dir, name);
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as T;
    } catch (error) {
      throw new EvalSuiteError(`invalid JSON in ${path}: ${(error as Error).message}`);
    }
  });
}

const SURFACES = new Set(['explore', 'executor', 'code-reviewer', 'team-worker', 'sparkshell']);

function validateFixture(fixture: EvalFixture): void {
  if (!fixture.id) throw new EvalSuiteError('fixture is missing an id');
  if (!SURFACES.has(fixture.surface)) {
    throw new EvalSuiteError(`fixture ${fixture.id} has unknown surface ${fixture.surface}`);
  }
  if (!fixture.prompt?.trim()) {
    throw new EvalSuiteError(`fixture ${fixture.id} is missing a prompt`);
  }
  if (!Array.isArray(fixture.checks) || fixture.checks.length === 0) {
    throw new EvalSuiteError(`fixture ${fixture.id} declares no quality checks`);
  }
  for (const check of fixture.checks) {
    if (!check.name) throw new EvalSuiteError(`fixture ${fixture.id} has an unnamed check`);
    if (!Array.isArray(check.values) || check.values.length === 0) {
      throw new EvalSuiteError(`check ${fixture.id}/${check.name} has no values`);
    }
  }
  const baseline = fixture.deterministicBaseline;
  if (baseline && !(baseline.source in fixture.inputs)) {
    throw new EvalSuiteError(
      `fixture ${fixture.id} baseline references missing input ${baseline.source}`,
    );
  }
  // Model configuration must never leak into a task fixture.
  for (const key of ['model', 'models', 'reasoningEffort', 'config'] as const) {
    if (key in (fixture as unknown as Record<string, unknown>)) {
      throw new EvalSuiteError(`fixture ${fixture.id} must not pin model configuration (${key})`);
    }
  }
}

function validateConfigs(configs: EvalConfig[], fixtures: EvalFixture[]): void {
  if (configs.length === 0) throw new EvalSuiteError('suite declares no configurations');
  const baselines = configs.filter((config) => config.isBaseline);
  if (baselines.length !== 1) {
    throw new EvalSuiteError(`suite must declare exactly one baseline, found ${baselines.length}`);
  }
  const surfaces = new Set(fixtures.map((fixture) => fixture.surface));
  const ids = new Set<string>();
  for (const config of configs) {
    if (!config.id) throw new EvalSuiteError('configuration is missing an id');
    if (ids.has(config.id) || config.id === 'deterministic-no-model') {
      throw new EvalSuiteError(`duplicate or reserved configuration id ${config.id}`);
    }
    ids.add(config.id);
    if (config.stages !== undefined) {
      parse(z.array(stageConfig).min(1), config.stages, `configuration ${config.id} stages`);
      if (new Set(config.stages.map((stage) => stage.id)).size !== config.stages.length) {
        throw new EvalSuiteError(`configuration ${config.id} has duplicate stage ids`);
      }
    }
    if (!config.omxRevision?.trim()) {
      throw new EvalSuiteError(`configuration ${config.id} is not pinned to an OMX revision`);
    }
    if (!config.serviceTier?.trim() || !config.cacheConditions?.trim()) {
      throw new EvalSuiteError(
        `configuration ${config.id} must record serviceTier and cacheConditions ("unknown" is allowed)`,
      );
    }
    for (const surface of surfaces) {
      const role = config.roles?.[surface];
      if (!role?.model?.trim() || !role?.reasoningEffort?.trim()) {
        throw new EvalSuiteError(
          `configuration ${config.id} is missing effective model/effort for ${surface}`,
        );
      }
    }
  }
}

export function validateSuite(suite: EvalSuite): EvalSuite {
  if (suite.fixtures.length === 0) throw new EvalSuiteError('suite declares no fixtures');
  const seen = new Set<string>();
  for (const fixture of suite.fixtures) {
    validateFixture(fixture);
    if (seen.has(fixture.id)) throw new EvalSuiteError(`duplicate fixture id ${fixture.id}`);
    seen.add(fixture.id);
  }
  validateConfigs(suite.configs, suite.fixtures);
  return suite;
}

export function loadSuite(suiteDir: string, configsDir = join(suiteDir, 'configs')): EvalSuite {
  const suite: EvalSuite = {
    fixtures: readJsonDir<EvalFixture>(join(suiteDir, 'fixtures')),
    configs: readJsonDir<EvalConfig>(configsDir),
  };
  return validateSuite(suite);
}

function tokenize(response: string): Set<string> {
  return new Set(
    response
      .split(/[\n,]/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0),
  );
}

function evaluateCheck(check: QualityCheck, response: string): CheckResult {
  const haystack = response.toLowerCase();
  if (check.kind === 'must-include') {
    const missing = check.values.filter((value) => !haystack.includes(value.toLowerCase()));
    return {
      name: check.name,
      kind: check.kind,
      passed: missing.length === 0,
      detail: missing.length ? `missing: ${missing.join(', ')}` : undefined,
    };
  }
  if (check.kind === 'must-not-include') {
    const present = check.values.filter((value) => haystack.includes(value.toLowerCase()));
    return {
      name: check.name,
      kind: check.kind,
      passed: present.length === 0,
      detail: present.length ? `unsupported content: ${present.join(', ')}` : undefined,
    };
  }
  const actual = tokenize(response);
  const expected = new Set(check.values);
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  return {
    name: check.name,
    kind: check.kind,
    passed: missing.length === 0 && extra.length === 0,
    detail:
      missing.length || extra.length
        ? `missing: [${missing.join(', ')}] extra: [${extra.join(', ')}]`
        : undefined,
  };
}

export function scoreResponse(fixture: EvalFixture, response: string): CheckResult[] {
  return fixture.checks.map((check) => evaluateCheck(check, response));
}

/** Deterministic, no-model answer for fixtures whose output contract permits it. */
export function runDeterministicBaseline(fixture: EvalFixture): string | null {
  const spec = fixture.deterministicBaseline;
  if (!spec) return null;
  const source = fixture.inputs[spec.source] ?? '';
  if (spec.extractor === 'failing-test-names') {
    const names: string[] = [];
    for (const line of source.split('\n')) {
      const match = /^\s*(?:not ok\s+\d+\s+-\s+|FAIL\s+)(.+?)\s*$/.exec(line);
      if (match) names.push(match[1]);
    }
    return names.join('\n');
  }
  const match = /^\s*exit(?:\s+code)?[:=]?\s*(\d+)\s*$/m.exec(source);
  return match ? match[1] : '';
}

export function baselineRecord(
  fixture: EvalFixture,
  configId = 'deterministic-no-model',
): RunRecord {
  const response = runDeterministicBaseline(fixture);
  if (response === null) {
    throw new EvalSuiteError(`fixture ${fixture.id} has no deterministic baseline`);
  }
  const checks = scoreResponse(fixture, response);
  return {
    fixtureId: fixture.id,
    configId,
    outcome: checks.every((check) => check.passed) ? 'pass' : 'fail',
    checks,
    requiredChecksPassed: null,
    retries: 0,
    latencyMs: null,
    usage: {
      inputTokens: 0, outputTokens: 0, uncachedInputTokens: 0, cacheReadTokens: 0,
      cacheWriteTokens: 'not-applicable', source: 'deterministic extractor; no model invoked',
    },
    operatorMinutes: 0,
    difficult: false,
    notes: 'deterministic extractor, no model invoked',
  };
}
