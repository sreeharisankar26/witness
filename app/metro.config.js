/**
 * Metro bundler config.
 *
 * The only reason this file exists: keep test files out of the app bundle.
 *
 * `src/engine/resolve.test.ts` and `src/data/sync.test.ts` import Node built-ins
 * — `node:test`, `node:assert`, `node:sqlite`, `node:fs`. Those cannot exist in
 * a React Native bundle. Nothing in the app imports them, so Metro should never
 * reach them, but a production export walks the tree differently to the dev
 * server, and "Unable to resolve module node:sqlite" is a bundle failure that
 * only appears on the build server.
 *
 * Blocking them costs nothing and removes the whole class of problem. The tests
 * still run under plain Node via `npm test`.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.blockList = [
  /.*\.test\.ts$/,
  /.*\.test\.tsx$/,
  /.*\/__tests__\/.*/,
];

module.exports = config;
