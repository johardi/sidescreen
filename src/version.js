import { readFileSync } from 'node:fs';

const packageJson = /** @type {{ version: string }} */ (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
);

/** The version declared in package.json. */
export const VERSION = packageJson.version;
