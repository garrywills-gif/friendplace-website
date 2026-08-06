#!/usr/bin/env node
/*
 * EAS remote build diagnostic.
 *
 * Runs on the EAS worker via the `eas-build-post-install` npm hook, AFTER
 * `yarn install` completes but BEFORE the PREBUILD phase. Its sole job is to
 * print a definitive audit of whether the files required by prebuild are
 * physically present at the EAS working directory root, and to prove whether
 * `.easignore` did or did not include `google-services.json` in the tarball.
 *
 * All output goes to stdout with a `[EAS_DIAG]` prefix so it's greppable in
 * the Expo build log. This script is a no-op locally (gated on EAS_BUILD env).
 */

const fs = require('fs');
const path = require('path');

const isEas = process.env.EAS_BUILD === 'true' || process.env.EAS_BUILD === '1';
const cwd = process.cwd();
const workingDir = process.env.EAS_BUILD_WORKINGDIR || cwd;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[EAS_DIAG] ${msg}`);
}

function fileReport(relPath) {
  const abs = path.join(workingDir, relPath);
  try {
    const stat = fs.statSync(abs);
    log(`  ✓ ${relPath}  (${stat.size} bytes, mode=${stat.mode.toString(8)})`);
    return true;
  } catch (err) {
    log(`  ✗ ${relPath}  MISSING  (${err.code})`);
    return false;
  }
}

log('===== EAS build environment audit =====');
log(`EAS_BUILD          = ${process.env.EAS_BUILD || '(unset)'}`);
log(`EAS_BUILD_PLATFORM = ${process.env.EAS_BUILD_PLATFORM || '(unset)'}`);
log(`EAS_BUILD_PROFILE  = ${process.env.EAS_BUILD_PROFILE || '(unset)'}`);
log(`EAS_BUILD_WORKINGDIR = ${workingDir}`);
log(`process.cwd()      = ${cwd}`);
log('');
log('----- Critical files at workingdir root -----');

const critical = [
  'google-services.json',
  'app.json',
  '.env',
  '.easignore',
  '.gitignore',
  'package.json',
  'assets/images/notification-icon.png',
];
let missing = 0;
for (const f of critical) {
  if (!fileReport(f)) missing++;
}

log('');
if (missing === 0) {
  log('RESULT: all critical files present. Prebuild should succeed.');
} else {
  log(`RESULT: ${missing} critical file(s) MISSING. Prebuild will likely fail.`);
  log('        If google-services.json is missing, `.easignore` did not achieve');
  log('        tarball inclusion. Fall back to EAS file secret env var:');
  log('        expo.dev → project → Environment Variables → add file secret');
  log('        `GOOGLE_SERVICES_JSON`, then set android.googleServicesFile to');
  log('        "$GOOGLE_SERVICES_JSON" in app.json.');
}

log('');
log('----- android/ directory (before prebuild) -----');
try {
  const androidExists = fs.existsSync(path.join(workingDir, 'android'));
  log(`  android/ exists BEFORE prebuild? ${androidExists}  (expected: false, managed workflow)`);
} catch (err) {
  log(`  android/ check failed: ${err.message}`);
}

log('===== end EAS_DIAG =====');

if (!isEas) {
  log('(local run — no failure will be raised)');
}

// Never fail the build from this diagnostic — it's read-only.
process.exit(0);
