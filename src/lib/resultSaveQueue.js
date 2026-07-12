// Durable-in-session queue for navigator result saves.
//
// Each result type/department has its own key so a later successful save cannot
// erase an unrelated failure. Generation numbers also make concurrent saves for
// the same key last-write-wins instead of re-queueing stale payloads.

export function resultSaveKey(args = []) {
  return `${args[0]}__${args[4] ?? 'pediatrics'}__${args[6] ?? 'mcq'}`;
}

export class ResultSaveQueue {
  constructor(saveFn) {
    this.saveFn = saveFn;
    this.pending = new Map();
    this.generations = new Map();
  }

  get size() {
    return this.pending.size;
  }

  async save(args, onSuccess) {
    const key = resultSaveKey(args);
    const generation = (this.generations.get(key) ?? 0) + 1;
    this.generations.set(key, generation);
    // A newer attempt supersedes an older queued payload for the same result
    // key. Removing it before the async write also prevents Retry from racing an
    // in-flight newer submission and overwriting it with stale data.
    this.pending.delete(key);
    try {
      await this.saveFn(...args);
      if (this.generations.get(key) === generation) {
        this.pending.delete(key);
        onSuccess?.();
      }
      return true;
    } catch {
      if (this.generations.get(key) === generation) {
        this.pending.set(key, { args, onSuccess });
      }
      return false;
    }
  }

  async retryAll() {
    const entries = [...this.pending.values()];
    return Promise.all(entries.map((entry) => this.save(entry.args, entry.onSuccess)));
  }
}
