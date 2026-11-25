# OMX default-model evaluation report

**Synthetic supplied observations — accounting examples, not measured model results.**

## Configurations
| config | baseline | omx revision | service tier | cache | code-reviewer | executor | explore | sparkshell | team-worker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| continue-pair | yes | 7a3cab6445db8313340779ba6298b3cae24eac6e | unknown | unknown; synthetic example does not observe cache reuse | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium |
| split-pair | no | 7a3cab6445db8313340779ba6298b3cae24eac6e | unknown | unknown; synthetic example does not observe cache reuse | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium | gpt-6-astra / medium |
Role pins above are configuration values; they do not prove runtime settings.

## Stage settings
| fixture / workflow | config / stage | surface / role | requested model / effort | override source (model / effort) | launch-resolved (source) | runtime-observed (source) |
| --- | --- | --- | --- | --- | --- | --- |
| executor-bounded-change / bounded-change-01 | continue-pair / planner | native-agent / planner | gpt-6-astra / high | proposed agentModels.planner / proposed agentReasoning.planner | gpt-6-astra / high (synthetic launch receipt) | gpt-6-astra / high (synthetic runtime receipt) |
| executor-bounded-change / bounded-change-01 | continue-pair / executor | native-agent / executor | gpt-6-astra / high | proposed agentModels.executor / proposed agentReasoning.executor | gpt-6-astra / high (synthetic launch receipt) | unknown |
| executor-bounded-change / bounded-change-01 | split-pair / planner | native-agent / planner | gpt-6-astra / high | proposed agentModels.planner / proposed agentReasoning.planner | gpt-6-astra / high (synthetic launch receipt) | gpt-6-astra / high (synthetic runtime receipt) |
| executor-bounded-change / bounded-change-01 | split-pair / executor | native-agent / executor | gpt-5.6-terra / medium | proposed agentModels.executor / proposed agentReasoning.executor | gpt-5.6-sol / high (synthetic explicit launch override (model and effort)) | gpt-6-astra / unknown (synthetic runtime receipt; effort unexposed) |
| sparkshell-exit-status / unknown | deterministic-no-model / unknown | unknown | unknown | unknown | unknown | unknown |
| sparkshell-failing-tests / unknown | deterministic-no-model / unknown | unknown | unknown | unknown | unknown | unknown |

## Per-task results
| fixture | config | declared outcome | failed response checks | retries | workflow elapsed ms | input/output | operator min | response grade | required checks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| executor-bounded-change | continue-pair | pass | — | 0 | 250 | 300/60 | 2 | pass | unknown |
| executor-bounded-change | split-pair | pass | — | 1 | 250 | 300/60 | 2 | pass | fail |
| sparkshell-exit-status | deterministic-no-model | pass | — | 0 | unknown | 0/0 | 0 | pass | unknown |
| sparkshell-failing-tests | deterministic-no-model | pass | — | 0 | unknown | 0/0 | 0 | pass | unknown |

## Aggregate per configuration
| config | declared pass | fail | error | difficult | retries | sum workflow elapsed ms | input/output | operator min |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| continue-pair | 1 | 0 | 0 | 0 | 0 | 250 | 300/60 | 2 |
| split-pair | 1 | 0 | 0 | 1 | 1 | 250 | 300/60 | 2 |
| deterministic-no-model | 2 | 0 | 0 | 0 | 0 | unknown | 0/0 | 0 |

## Usage observations
Input/output are inclusive totals. Uncached input and cache reads partition input; cache writes are separate observations, never added to input. Reasoning is already in output.
| scope | input | output | uncached input | cache read | cache write | source | stage duration ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| executor-bounded-change @ continue-pair: planner (canonical) | 100 | 20 | 80 | 20 | 1 unsupported | synthetic token counters | 100 |
| executor-bounded-change @ continue-pair: executor (canonical) | 200 | 40 | 200 | 0 | 1 unsupported | synthetic token counters | 200 |
| executor-bounded-change @ split-pair: planner (canonical) | 100 | 20 | 80 | 20 | 1 unsupported | synthetic token counters | 100 |
| executor-bounded-change @ split-pair: executor (canonical) | 200 | 40 | 1 unknown | 0 | 1 unknown | synthetic partial token counters | 200 |
| sparkshell-exit-status @ deterministic-no-model: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| sparkshell-failing-tests @ deterministic-no-model: workflow (canonical) | 0 | 0 | 0 | 0 | 1 not-applicable | deterministic extractor; no model invoked | not-applicable |
| continue-pair: aggregate canonical usage | 300 | 60 | 280 | 20 | 2 unsupported | supplied records above | not-applicable |
| split-pair: aggregate canonical usage | 300 | 60 | 80 known; 1 unknown | 20 | 1 unknown, 1 unsupported | supplied records above | not-applicable |
| deterministic-no-model: aggregate canonical usage | 0 | 0 | 0 | 0 | 2 not-applicable | supplied records above | not-applicable |
Stage rows are not task outcomes. Stage durations are not workflow wall time; operator time is separate. Known sums exclude missing measurements.

## Failed and difficult cases (including unverified checks)
- `executor-bounded-change` @ `continue-pair`: pass
  Required checks: unknown; declared outcome is not verified completion.
- `executor-bounded-change` @ `split-pair`: pass (difficult)
  Required checks: fail; declared outcome is not verified completion.
- `sparkshell-exit-status` @ `deterministic-no-model`: pass
  Required checks: unknown; declared outcome is not verified completion.
- `sparkshell-failing-tests` @ `deterministic-no-model`: pass
  Required checks: unknown; declared outcome is not verified completion.

## Cost claims
Usage attribution is incomplete for: continue-pair, split-pair. No complete cost claim is made for those configurations.
A lower token count alone is not a successful result.
Declared pass counts and rates do not certify executed checks, independent review, or accepted completion. No model quality, cost, or savings conclusion is established by this report.

## Workload-weighted summary
Not reported: documented, representative task frequencies are missing for at least one evaluated fixture. Per-task results above stand on their own and imply no representative savings.

## Limitations
- Estimates (implementation/maintenance effort) are labeled separately from measurements.
- Identical reasoning-effort labels across models do not establish equivalent quality or cost.
- Codex-owned context, caching, and compaction behavior is not controlled by this suite; such fields are recorded as observed or `unknown`.
