import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runWatchMode } from '../index.js';
import { createHudOwnerAliveProbe } from '../watch-owner.js';
import type { SessionPointerReadResult, SessionState } from '../../hooks/session.js';

const env = { TMUX: 'test', TMUX_PANE: '%2', OMX_TMUX_HUD_OWNER: '1', OMX_TMUX_HUD_LEADER_PANE: '%1', OMX_SESSION_ID: 'sess-a' };
const state: SessionState = { session_id: 'sess-a', started_at: '', cwd: '/tmp', pid: 123, tmux_pane_id: '%1' };

describe('HUD owner liveness', () => {
  for (const [name, snapshot, expected] of [
    ['closed leader', '%2\t0\n%3\t0', false],
    ['dead leader kept by remain-on-exit', '%1\t1\n%2\t0', false],
    ['live leader anywhere on the server', '%2\t0\n%1\t0', true],
    ['unknown HUD', '%3\t0', true],
    ['empty response', '', true],
    ['malformed response', '%2\t0\ninvalid', true],
  ] as const) {
    it(`handles ${name} without requiring a session pointer`, async () => {
      const alive = createHudOwnerAliveProbe(env, {
        execTmuxSync: args => {
          assert.deepEqual(args, ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_dead}']);
          return snapshot;
        },
        readPointer: async () => ({ status: 'absent' }),
      });
      assert.equal(await alive('/tmp'), expected);
    });
  }

  it('preserves a HUD when tmux cannot be queried and owner state is absent', async () => {
    const alive = createHudOwnerAliveProbe(env, {
      execTmuxSync: () => { throw new Error('server unavailable'); },
      readPointer: async () => ({ status: 'absent' }),
    });
    assert.equal(await alive('/tmp'), true);
  });

  for (const status of ['absent', 'malformed', 'foreign-cwd'] as const) {
    it(`does not treat ${status} state as an exited owner`, async () => {
      const alive = createHudOwnerAliveProbe(env, {
        readPointer: async () => ({ status, state }),
        classify: () => { throw new Error('untrusted state must not be classified'); },
      });
      assert.equal(await alive('/tmp'), true);
    });
  }

  it('retains the exact owner across pointer deletion/replacement and detects its death', async () => {
    let pointer: SessionPointerReadResult = { status: 'usable', state };
    let status: 'usable' | 'stale-dead' | 'identity-indeterminate' = 'usable';
    const alive = createHudOwnerAliveProbe(env, {
      readPointer: async () => pointer,
      classify: owner => { assert.equal(owner, state); return status; },
    });
    assert.equal(await alive('/tmp'), true);
    pointer = { status: 'usable', state: { ...state, session_id: 'sibling', pid: 456 } };
    assert.equal(await alive('/tmp'), true);
    pointer = { status: 'absent' };
    status = 'identity-indeterminate';
    assert.equal(await alive('/tmp'), true);
    status = 'stale-dead';
    assert.equal(await alive('/tmp'), false);
  });

  it('recognizes native session aliases but not foreign leaders or malformed pids', async () => {
    for (const candidate of [
      { ...state, tmux_pane_id: '%3' },
      { ...state, pid: 0 },
      { ...state, session_id: 'foreign' },
    ]) {
      const alive = createHudOwnerAliveProbe(env, {
        readPointer: async () => ({ status: 'stale-dead', state: candidate }),
        classify: () => 'stale-dead',
      });
      assert.equal(await alive('/tmp'), true);
    }
    const alive = createHudOwnerAliveProbe(env, {
      readPointer: async () => ({ status: 'stale-dead', state: { ...state, session_id: 'native-a', owner_omx_session_id: 'sess-a' } }),
      classify: () => 'stale-dead',
    });
    assert.equal(await alive('/tmp'), false);
  });

  it('preserves standalone watches and fails open on observation errors', async () => {
    for (const candidate of [{}, { ...env, OMX_TMUX_HUD_OWNER: '0' }, { ...env, TMUX_PANE: '%1' }, env]) {
      const alive = createHudOwnerAliveProbe(candidate, { readPointer: async () => { throw new Error('unavailable'); } });
      assert.equal(await alive('/tmp'), true);
    }
  });
});

describe('HUD owner shutdown', () => {
  for (const attached of [true, false]) {
    it(`stops its timer and owned pane before rendering/reconciling a dead owner (attached=${attached})`, async () => {
      let stop: (() => void) | undefined;
      let cleared = false;
      let closed = false;
      let renders = 0;
      let reconciles = 0;
      let ticks = 0;
      const watch = runWatchMode('/tmp', { watch: true, json: false, tmux: false }, {
        isTTY: true,
        env: { TMUX: 'test', TMUX_PANE: '%2', OMX_TMUX_HUD_OWNER: '1', OMX_TMUX_HUD_LEADER_PANE: '%1', OMX_SESSION_ID: 'sess-a' },
        isOwnerAliveFn: async () => false,
        closeOwnedPaneFn: () => { closed = true; },
        isSessionAttachedFn: () => attached,
        readHudConfigFn: async () => ({ preset: 'focused', git: { display: 'branch' }, statusLine: { preset: 'focused' } }),
        readAllStateFn: async () => { renders++; throw new Error('dead owner must not render'); },
        runAuthorityTickFn: async () => { ticks++; },
        reconcileTmuxHudFn: async () => { reconciles++; },
        writeStdout: () => {},
        writeStderr: () => {},
        registerSigint: handler => { stop = handler; },
        setIntervalFn: () => ({} as ReturnType<typeof setInterval>),
        clearIntervalFn: () => { cleared = true; },
      });
      try {
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(closed, true);
        assert.equal(cleared, true);
        assert.equal(renders, 0);
        assert.equal(reconciles, 0);
        assert.equal(ticks, 0);
      } finally {
        stop?.();
        await watch;
        process.exitCode = undefined;
      }
    });
  }
});
