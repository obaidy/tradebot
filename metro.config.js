const path = require('path');
const { getDefaultConfig } = require('@expo/metro-config');

const projectRoot = __dirname;
const mobileRoot = path.join(projectRoot, 'apps', 'mobile');

const config = getDefaultConfig(projectRoot);

config.watchFolders = Array.from(
  new Set([...(config.watchFolders || []), mobileRoot]),
);

config.resolver = config.resolver || {};
const escapeForRegex = (filePath) =>
  filePath.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const exclusionList = require('metro-config/src/defaults/exclusionList');

config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  'react-native': path.join(mobileRoot, 'node_modules', 'react-native'),
};

config.resolver.alias = {
  ...(config.resolver.alias || {}),
  '@': path.join(mobileRoot, 'src'),
};

config.resolver.nodeModulesPaths = Array.from(
  new Set([
    path.join(projectRoot, 'node_modules'),
    path.join(mobileRoot, 'node_modules'),
  ]),
);
config.resolver.blockList = exclusionList([
  new RegExp(
    `^${escapeForRegex(
      path.join(projectRoot, 'node_modules', 'react-native'),
    )}\\/.*$`,
  ),
]);

module.exports = config;
