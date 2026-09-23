const { withAppBuildGradle } = require("expo/config-plugins");

// Hermes' bytecode optimizer is the memory peak of the release bundling step, and
// a 16 GB EAS worker kills hermesc (exit 137) on this app's bundle. Compiling
// without -O keeps the source map and produces larger but valid bytecode.
const HERMES_FLAGS = '["-output-source-map"]';

function withAndroidHermesFlags(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (/^\s*hermesFlags\s*=/m.test(contents)) {
      return modConfig;
    }

    modConfig.modResults.contents = contents.replace(
      /(react\s*\{)/,
      `$1\n    hermesFlags = ${HERMES_FLAGS}`,
    );
    return modConfig;
  });
}

module.exports = withAndroidHermesFlags;
