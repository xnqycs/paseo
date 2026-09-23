const { withAppBuildGradle } = require("expo/config-plugins");

// Release bundling on a 16 GB worker (EAS medium, or a laptop) dies when hermesc is
// killed compiling this app's ~46 MB bundle, and the local machine needs >11 GB for
// the same step. Two knobs keep the peak down:
//   - Metro minifies the JS even though Hermes is enabled, which halves the input the
//     bytecode compiler has to hold (React Native skips minification when Hermes is on).
//   - hermesc runs without its -O optimization passes; bytecode is larger, memory lower.
const REACT_BLOCK_TUNING = [
  'hermesFlags = ["-output-source-map"]',
  'extraPackagerArgs = ["--minify", "true"]',
].join("\n    ");

function withAndroidReleaseBuildTuning(config) {
  return withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (/^\s*extraPackagerArgs\s*=/m.test(contents)) {
      return modConfig;
    }

    modConfig.modResults.contents = contents.replace(
      /(react\s*\{)/,
      `$1\n    ${REACT_BLOCK_TUNING}`,
    );
    return modConfig;
  });
}

module.exports = withAndroidReleaseBuildTuning;
