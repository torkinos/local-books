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

// The workspace TS sources use NodeNext ESM specifiers ("./types/index.js")
// which Metro won't map back to .ts on its own. For relative imports coming
// from a TS file, drop the ".js" so Metro's sourceExts (ts, tsx, js, ...)
// resolve the real file. Package subpaths like "@noble/hashes/sha2.js" are
// untouched — they point at real .js files via package exports.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.startsWith('.') &&
    moduleName.endsWith('.js') &&
    /\.tsx?$/.test(context.originModulePath)
  ) {
    moduleName = moduleName.slice(0, -'.js'.length);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
