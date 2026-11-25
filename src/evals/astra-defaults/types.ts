/**
 * Model-agnostic evaluation contract for OMX role fixtures (issue #3655).
 *
 * Task fixtures and quality checks are deliberately kept separate from model
 * configuration so the same fixtures stay reusable when OMX changes defaults.
 * Astra defaults are only the initial baseline configuration.
 */

export type EvalSurface = 'explore' | 'executor' | 'code-reviewer' | 'team-worker' | 'sparkshell';

export type QualityCheck =
  | { kind: 'must-include'; name: string; values: string[] }
  | { kind: 'must-not-include'; name: string; values: string[] }
  | { kind: 'exact-set'; name: string; values: string[] };

export type DeterministicExtractor = 'failing-test-names' | 'exit-status';

export interface DeterministicBaselineSpec {
  /** Extractor applied to `inputs[source]` to produce a no-model answer. */
  extractor: DeterministicExtractor;
  source: string;
}

export interface EvalFixture {
  id: string;
  surface: EvalSurface;
  title: string;
  /** Task statement handed to the evaluated configuration. */
  prompt: string;
  /** Fixed inputs (command output, diff, file excerpt) shared by every configuration. */
  inputs: Record<string, string>;
  checks: QualityCheck[];
  /**
   * Present only when the output contract permits a deterministic, no-model
   * answer. Interpretation-heavy fixtures intentionally omit it.
   */
  deterministicBaseline?: DeterministicBaselineSpec;
}

export interface PinnedRoleConfig {
  model: string;
  reasoningEffort: string;
}

export interface StageConfig {
  id: string;
  role: string;
  surface: 'main' | 'native-agent' | 'team-worker' | 'sparkshell';
  requested: PinnedRoleConfig;
  overrideSource: { model: string; reasoningEffort: string };
}

/** Supplied evidence, never inferred from configuration or parent fallback. */
export interface SettingsObservation {
  model: string | null;
  reasoningEffort: string | null;
  source: string;
}

export interface StageRecord {
  stageId: string;
  launchResolved?: SettingsObservation;
  runtimeObserved?: SettingsObservation;
  usage: Usage | null;
  latencyMs: number | null;
}

export interface EvalConfig {
  id: string;
  label: string;
  isBaseline: boolean;
  omxRevision: string;
  /** Keyed by surface; every surface exercised by the fixtures must be present. */
  roles: Record<string, PinnedRoleConfig>;
  /** `unknown` is a valid, explicit value: OMX does not own Codex caching. */
  serviceTier: string;
  cacheConditions: string;
  /** Experiment descriptors, not routing instructions or new fixture surfaces. */
  stages?: StageConfig[];
}

export interface EvalSuite {
  fixtures: EvalFixture[];
  configs: EvalConfig[];
}

export interface CheckResult {
  name: string;
  kind: QualityCheck['kind'];
  passed: boolean;
  detail?: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  uncachedInputTokens?: TokenObservation;
  cacheReadTokens?: TokenObservation;
  cacheWriteTokens?: TokenObservation;
  source?: string;
}

export type TokenObservation = number | null | 'unsupported' | 'not-applicable';

export interface RunRecord {
  fixtureId: string;
  configId: string;
  outcome: 'pass' | 'fail' | 'error';
  checks: CheckResult[];
  /** Required checks owned by the fixture repo (build/tests), not by the grader. */
  requiredChecksPassed: boolean | null;
  retries: number;
  latencyMs: number | null;
  /** `null` means usage attribution was unavailable, never zero. */
  usage: Usage | null;
  /** Operator intervention/review/repair time, reported separately from model cost. */
  operatorMinutes: number | null;
  difficult: boolean;
  notes?: string;
  workflowId?: string;
  /** Exactly one accounting level; stage scope requires usage: null above. */
  usageScope?: 'workflow' | 'stages';
  stages?: StageRecord[];
}

export interface SuppliedRecords {
  evidence: 'synthetic' | 'observed';
  records: RunRecord[];
}

/** Documented task frequencies; required before any workload-weighted claim. */
export type TaskFrequencies = Record<string, number>;
