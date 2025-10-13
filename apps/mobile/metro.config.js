const path = require('path');
const { getDefaultConfig } = require('@expo/metro-config');

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

module.exports = config;
