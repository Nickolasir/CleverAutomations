const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = path.resolve(__dirname);
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Watch shared package + root node_modules for hoisted dependency resolution
config.watchFolders = [
  path.resolve(monorepoRoot, "packages/shared"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Resolve modules from both the mobile-app and root node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Force scheduler to resolve to react-native's nested copy (0.24.0-canary)
// which has the required .native entry points
config.resolver.extraNodeModules = {
  scheduler: path.resolve(
    monorepoRoot,
    "node_modules/react-native/node_modules/scheduler"
  ),
};

module.exports = config;
