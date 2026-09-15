# Summary of the change

The store is now a single JSON file under `ANNOTATR_STATE_DIR`, written through one async mutex.
Two concurrent ingests **cannot** lose a write, and a *corrupt* file is an error rather than a reset.

## What changed

- `src/store.js`: added `Store.update()` with a directory lock
- `src/mutex.js`: a promise-chain mutex
- `test/store.test.js`: fires two concurrent `annotatr ingest` processes

1. Read the current state
2. Apply the mutator
3. Rename the temporary file into place

```js
await store.update((state) => {
  state.turns[turn.promptId] = turn;
});
```

```
plain fence without a language
```

> The lock is a directory because `mkdir` is atomic everywhere Node runs.

| Path | Purpose |
| --- | --- |
| `store.json` | the state |
| `store.lock` | the lock |

See [the design](https://example.com/design) and [a bad link](javascript:alert(1)).

Raw HTML like <script>alert('x')</script> and <b>bold</b> is shown, not run.

<div class="callout">A block of raw HTML.</div>

Done. Run `npm test` to verify.
