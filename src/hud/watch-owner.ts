import {
  classifySessionStateLiveness,
  readSessionPointer,
  resolveSessionPointerContext,
  type SessionState,
} from '../hooks/session.js';
import { killTmuxPaneIfCurrent, parseCanonicalTmuxPaneId } from './tmux.js';

/** Unknown/replaced state is not proof that this watcher's owner has exited. */
export function createHudOwnerAliveProbe(
  env: NodeJS.ProcessEnv,
  deps: {
    readPointer?: typeof readSessionPointer;
    classify?: typeof classifySessionStateLiveness;
  } = {},
): (cwd: string) => Promise<boolean> {
  let owner: SessionState | undefined;
  const sessionId = env.OMX_SESSION_ID?.trim();
  const leader = parseCanonicalTmuxPaneId(env.OMX_TMUX_HUD_LEADER_PANE);
  const hud = parseCanonicalTmuxPaneId(env.TMUX_PANE);
  return async cwd => {
    if (!env.TMUX || env.OMX_TMUX_HUD_OWNER !== '1' || !sessionId || !leader || !hud || leader === hud) return true;
    try {
      const pointer = await (deps.readPointer ?? readSessionPointer)(resolveSessionPointerContext(cwd, env));
      const state = pointer.state;
      if (state && ['usable', 'stale-dead', 'identity-indeterminate'].includes(pointer.status)
        && Number.isSafeInteger(state.pid) && state.pid > 0
        && [state.session_id, state.owner_omx_session_id].includes(sessionId)
        && (!state.tmux_pane_id || state.tmux_pane_id === leader)) {
        owner = state;
      }
      // Retain the exact owner across pointer removal/replacement at shutdown.
      // This also avoids reaping a still-running sibling that shares the cwd.
      return !owner || (deps.classify ?? classifySessionStateLiveness)(owner) !== 'stale-dead';
    } catch {
      return true;
    }
  };
}

export function closeOwnedHudPane(env: NodeJS.ProcessEnv): void {
  const paneId = parseCanonicalTmuxPaneId(env.TMUX_PANE);
  if (!env.TMUX || env.OMX_TMUX_HUD_OWNER !== '1' || !paneId
    || paneId === env.OMX_TMUX_HUD_LEADER_PANE) return;
  // Removing only our process's pane also handles remain-on-exit. A respawned
  // pane or a shell hosting a manually started watcher is never killed.
  killTmuxPaneIfCurrent(paneId, String(process.pid));
}
