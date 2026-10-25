import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_SESSION = Object.freeze({
  persona: 'ex',
  memoryEnabled: true,
  ttsEnabled: true,
});

/** Stable content fingerprint used for idempotent retain requests. */
export function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * Per-session persona/memory state plus the local remembered-content set.
 * The state file is deliberately plain JSON outside the session log: it is
 * plugin configuration, not model-visible history.
 */
export class SessionStore {
  /**
   * @param {string} file - absolute state JSON path.
   * @param {{ defaultPersona?: 'ex'|'assistant', defaultMemoryEnabled?: boolean, logger?: { warn: Function } }} options
   */
  constructor(file, options = {}) {
    this.file = file;
    this.logger = options.logger;
    this.defaults = {
      persona: options.defaultPersona === 'assistant' ? 'assistant' : 'ex',
      memoryEnabled:
        options.defaultPersona === 'assistant' ? false : options.defaultMemoryEnabled !== false,
      ttsEnabled: true,
    };
    this.state = { version: 1, sessions: {}, remembered: {} };
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      this.state = {
        version: 1,
        sessions:
          parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
            ? parsed.sessions
            : {},
        remembered:
          parsed.remembered !== null && typeof parsed.remembered === 'object' && !Array.isArray(parsed.remembered)
            ? parsed.remembered
            : {},
      };
    } catch (error) {
      this.logger?.warn(`[xiaoyuer] state file could not be read; starting fresh: ${error.message}`);
      this.state = { version: 1, sessions: {}, remembered: {} };
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      fs.renameSync(temporary, this.file);
    } catch (error) {
      this.logger?.warn(`[xiaoyuer] state file could not be written: ${error.message}`);
    }
  }

  /**
   * Read one session's effective settings without creating a persisted row.
   * @param {string} sessionId
   */
  get(sessionId) {
    const stored = this.state.sessions[sessionId];
    const persona = stored?.persona === 'assistant' ? 'assistant' : stored?.persona === 'ex' ? 'ex' : this.defaults.persona;
    const memoryEnabled =
      persona === 'assistant'
        ? false
        : typeof stored?.memoryEnabled === 'boolean'
          ? stored.memoryEnabled
          : this.defaults.memoryEnabled;
    return {
      sessionId,
      persona,
      memoryEnabled,
      ttsEnabled: typeof stored?.ttsEnabled === 'boolean' ? stored.ttsEnabled : this.defaults.ttsEnabled,
      persisted: stored !== undefined,
    };
  }

  /**
   * Apply a partial update. Assistant persona always hard-disables memory.
   * @param {string} sessionId
   * @param {{ persona?: 'ex'|'assistant', memoryEnabled?: boolean, ttsEnabled?: boolean }} patch
   */
  update(sessionId, patch) {
    const current = this.get(sessionId);
    const next = {
      persona: patch.persona === 'assistant' ? 'assistant' : patch.persona === 'ex' ? 'ex' : current.persona,
      memoryEnabled: current.memoryEnabled,
      ttsEnabled: current.ttsEnabled,
    };
    if (typeof patch.memoryEnabled === 'boolean') next.memoryEnabled = patch.memoryEnabled;
    if (typeof patch.ttsEnabled === 'boolean') next.ttsEnabled = patch.ttsEnabled;
    if (next.persona === 'assistant') next.memoryEnabled = false;
    this.state.sessions[sessionId] = next;
    this.save();
    return this.get(sessionId);
  }

  /** Whether this exact content was already retained successfully. */
  hasRemembered(contentFingerprint) {
    return Object.hasOwn(this.state.remembered, contentFingerprint);
  }

  /** Record a successful retain without unbounded growth. */
  markRemembered(contentFingerprint) {
    this.state.remembered[contentFingerprint] = new Date().toISOString();
    const entries = Object.entries(this.state.remembered);
    if (entries.length > 5_000) {
      entries.sort((left, right) => String(left[1]).localeCompare(String(right[1])));
      this.state.remembered = Object.fromEntries(entries.slice(-4_000));
    }
    this.save();
  }

  /** Copy for diagnostics, without exposing any other session's data through a route. */
  counts() {
    return {
      sessions: Object.keys(this.state.sessions).length,
      remembered: Object.keys(this.state.remembered).length,
    };
  }
}
