import { join } from 'node:path';
import { baselineRecord, loadRunRecords, loadSuite } from '../../evals/astra-defaults/suite.js';
import { renderReport } from '../../evals/astra-defaults/report.js';

try {
  const args = process.argv.slice(2);
  const suiteDir = args[0] && !args[0].startsWith('--')
    ? args.shift()! : join(process.cwd(), 'missions', 'astra-default-evaluation');
  const options = new Map<string, string>();
  while (args.length) {
    const option = args.shift()!;
    const value = args.shift();
    if (!['--report', '--configs'].includes(option) || !value || value.startsWith('--') || options.has(option)) {
      throw new Error('usage: eval-astra-defaults [suite-dir] [--report records.json [--configs config-dir]]');
    }
    options.set(option, value);
  }
  if (options.has('--configs') && !options.has('--report')) throw new Error('--configs requires --report');
  const suite = loadSuite(suiteDir, options.get('--configs'));
  const deterministic = suite.fixtures.filter((fixture) => fixture.deterministicBaseline);
  if (!options.has('--report') && deterministic.length === 0) {
    throw new Error('suite declares no deterministic no-model baseline');
  }
  const records = deterministic.map((fixture) => baselineRecord(fixture));
  if (options.has('--report')) {
    const supplied = loadRunRecords(options.get('--report')!, suite);
    process.stdout.write(`${renderReport(suite, [...supplied.records, ...records], null, supplied.evidence)}\n`);
    process.exit(0);
  }
  const passed = records.filter((record) => record.outcome === 'pass');
  const pass = passed.length === records.length;
  for (const record of records.filter((record) => record.outcome !== 'pass')) {
    process.stderr.write(
      `${record.fixtureId}: ${record.checks
        .filter((check) => !check.passed)
        .map((check) => `${check.name} ${check.detail ?? ''}`)
        .join('; ')}\n`,
    );
  }
  process.stdout.write(
    JSON.stringify({
      pass,
      score: Number((passed.length / records.length).toFixed(2)),
      fixtures: suite.fixtures.length,
      configs: suite.configs.length,
      deterministicBaselines: records.length,
    }),
  );
  process.exit(pass ? 0 : 1);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.stdout.write(JSON.stringify({ pass: false, score: 0 }));
  process.exit(1);
}
