// Dynamic Expo config wrapper. Ensures android.googleServicesFile resolves to an
// ABSOLUTE path at build time, regardless of where the EAS/prebuild working directory
// is anchored. Fixes the recurring `ENOENT: google-services.json` failure caused by
// relative-path ambiguity between the Emergent workspace root (/app) and the Expo
// project root (/app/frontend).
//
// The base config still lives in app.json (single source of truth); this file only
// overrides the one path that must be absolute for EAS remote builds to succeed.

const path = require('path');
const fs = require('fs');
const baseConfig = require('./app.json');

// Resolve google-services.json against this config file's directory (which is the
// Expo project root wherever it is checked out — locally at /app/frontend, or at
// /home/expo/workingdir/build on the EAS remote worker).
const googleServicesAbsolute = path.join(__dirname, 'google-services.json');

// Belt-and-braces: log clearly during prebuild so build logs make the resolution
// unambiguous if we ever have to debug this again.
if (process.env.EAS_BUILD || process.env.EXPO_DEBUG) {
  const exists = fs.existsSync(googleServicesAbsolute);
  // eslint-disable-next-line no-console
  console.log(
    `[app.config.js] googleServicesFile => ${googleServicesAbsolute} (exists: ${exists})`
  );
}

module.exports = ({ config: _config }) => {
  const expo = { ...(baseConfig.expo || {}) };
  expo.android = {
    ...(expo.android || {}),
    googleServicesFile: googleServicesAbsolute,
  };
  return { ...baseConfig, expo };
};
