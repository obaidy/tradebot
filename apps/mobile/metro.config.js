const path = require('path');
const { getDefaultConfig } = require('@expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), workspaceRoot]),
);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
  immer: path.resolve(
    workspaceRoot,
    'node_modules',
    '@reduxjs',
    'toolkit',
    'node_modules',
    'immer'
  ),
};
config.resolver.alias = {
  ...(config.resolver.alias || {}),
  '@': path.resolve(projectRoot, 'src'),
};
config.resolver.disableHierarchicalLookup = true;
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
