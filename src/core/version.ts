import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

/** Single source of truth — always matches package.json "version". */
export const VERSION: string = pkg.version;
