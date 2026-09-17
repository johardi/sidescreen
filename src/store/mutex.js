/**
 * A minimal async mutex. Callers queue behind one another, so at most one
 * critical section runs at a time within this process.
 */
export class Mutex {
  /** @type {Promise<void>} */
  #tail = Promise.resolve();

  /**
   * Run `fn` once every earlier caller has finished.
   *
   * @template T
   * @param {() => Promise<T>|T} fn
   * @returns {Promise<T>}
   */
  async runExclusive(fn) {
    const previous = this.#tail;
    /** @type {() => void} */
    let release = () => {};
    this.#tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
