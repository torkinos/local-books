/**
 * Monorepo-aware Metro config.
 *
 * @local-books/core is consumed as TypeScript source straight from the workspace
 * (its package.json main points at src/index.ts), so Metro must watch the workspace
 * root and resolve from both node_modules trees. babel-preset-expo transpiles the
 * core package's TS; core stays free of any build step.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

module.exports = config;
