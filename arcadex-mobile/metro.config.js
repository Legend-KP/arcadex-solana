const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Solana / crypto packages expect Node-ish resolution in RN.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  buffer: require.resolve("buffer"),
  crypto: require.resolve("expo-crypto"),
};

config.resolver.sourceExts = [...config.resolver.sourceExts, "cjs", "mjs"];

module.exports = config;
