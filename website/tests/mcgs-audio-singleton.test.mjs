/**
 * Regression tests for the MCGS audio playback singleton.
 *
 * The bug: George could start speaking a new response while previous
 * responses were still playing — three voices audible at once. This
 * suite locks in the "one voice at a time" invariant.
 *
 * Run:   node --test tests/mcgs-audio-singleton.test.mjs
 * (from /app/website)
 *
 * We deliberately avoid pulling in vitest/jest/happy-dom just for
 * this one module — the singleton is framework-agnostic and can be
 * exercised with a minimal stub of HTMLAudioElement + node's built-in
 * test runner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Compile the TypeScript singleton once via typescript (dev-dep so
// already installed), so we can import the runtime output. Falls
// back to esbuild if TS isn't present.
async function loadSingleton() {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(process.cwd(), 'lib/mcgs-audio-singleton.ts'),
    'utf8',
  );
  let compiled;
  try {
    const ts = require('typescript');
    compiled = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText;
  } catch {
    try {
      const esbuild = require('esbuild');
      compiled = esbuild.transformSync(src, {
        loader: 'ts',
        format: 'esm',
        target: 'node18',
      }).code;
    } catch {
      throw new Error(
        'Neither typescript nor esbuild available to compile ' +
        'lib/mcgs-audio-singleton.ts for the test runner.',
      );
    }
  }
  const dataUri = 'data:text/javascript;base64,' +
    Buffer.from(compiled).toString('base64');
  return await import(dataUri);
}

/**
 * Bare-bones HTMLAudioElement stub. Tracks paused / currentTime /
 * src and lets us assert on how many times pause() was called.
 */
function makeAudioStub(id) {
  return {
    id,
    paused: false,
    currentTime: 0.7,
    src: `blob:mock/${id}`,
    _pauseCount: 0,
    _srcRemoved: false,
    pause() { this.paused = true; this._pauseCount += 1; },
    load() { /* noop */ },
    removeAttribute(attr) { if (attr === 'src') { this._srcRemoved = true; } },
  };
}

test('a single claim registers the owner', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  let aStopped = false;
  S.claimPlayback(A, () => { aStopped = true; });

  assert.equal(S._peekCurrentElementForTest(), A);
  assert.equal(S.isSomethingPlaying(), true);
  assert.equal(aStopped, false, 'no other owner existed to stop');
});

test('claiming a second owner stops and disposes the first', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  const B = makeAudioStub('B');
  let aStopped = false;
  let bStopped = false;

  S.claimPlayback(A, () => { aStopped = true; });
  S.claimPlayback(B, () => { bStopped = true; });

  // A must have been paused, cleared, currentTime reset AND its
  // onStopped callback must have fired (so the previous bubble
  // resets its UI to idle).
  assert.equal(A._pauseCount, 1, 'A was paused exactly once');
  assert.equal(A.currentTime, 0, 'A.currentTime reset to 0');
  assert.equal(A._srcRemoved, true, 'A.src was cleared to stop buffering');
  assert.equal(aStopped, true, 'A.onStopped fired so its UI can reset');
  assert.equal(bStopped, false, 'B is now the active owner');
  assert.equal(S._peekCurrentElementForTest(), B);
});

test('stopCurrentPlayback disposes the sole owner and clears state', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  let aStopped = false;
  S.claimPlayback(A, () => { aStopped = true; });

  S.stopCurrentPlayback();

  assert.equal(aStopped, true);
  assert.equal(S._peekCurrentElementForTest(), null);
  assert.equal(S.isSomethingPlaying(), false);
});

test('stopCurrentPlayback is safe when nothing is playing', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  // Should not throw.
  S.stopCurrentPlayback();
  S.stopCurrentPlayback();
  assert.equal(S._peekCurrentElementForTest(), null);
});

test('releasePlayback only clears the slot for the matching element', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  const B = makeAudioStub('B');
  S.claimPlayback(A, () => {});
  // Releasing a *different* element must NOT evict A.
  S.releasePlayback(B);
  assert.equal(S._peekCurrentElementForTest(), A);

  // Releasing A does evict it.
  S.releasePlayback(A);
  assert.equal(S._peekCurrentElementForTest(), null);
});

test('rapid claims never leave more than one active owner', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const stopped = new Set();
  const audios = Array.from({ length: 10 }, (_, i) => makeAudioStub(`R${i}`));

  // Simulate 10 responses landing in quick succession, each with
  // auto-speak firing.
  for (const el of audios) {
    S.claimPlayback(el, () => { stopped.add(el.id); });
  }

  const current = S._peekCurrentElementForTest();
  assert.equal(current, audios[audios.length - 1],
    'Only the LAST claim should hold the slot');

  // Every previous owner must have been told to stop and been paused.
  for (let i = 0; i < audios.length - 1; i++) {
    assert.equal(audios[i]._pauseCount, 1,
      `Owner ${audios[i].id} should have been paused when displaced`);
    assert.equal(stopped.has(audios[i].id), true,
      `Owner ${audios[i].id} should have had onStopped fired`);
  }
  // The current owner has NOT been stopped.
  assert.equal(stopped.has(current.id), false);
});

test('stopCurrentPlayback during navigation (close/minimise) kills orphan audio', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  let stopped = false;
  S.claimPlayback(A, () => { stopped = true; });

  // Sheet closes / route changes.
  S.stopCurrentPlayback();

  // No audio in flight, no owner held, no orphan buffering.
  assert.equal(A._srcRemoved, true, 'src cleared to stop background buffering');
  assert.equal(stopped, true, 'owner UI notified');
  assert.equal(S.isSomethingPlaying(), false);
});

test('a fresh play cycle after stopCurrentPlayback works', async () => {
  const S = await loadSingleton();
  S._resetForTest();

  const A = makeAudioStub('A');
  S.claimPlayback(A, () => {});
  S.stopCurrentPlayback();

  // Later, a new bubble tries to play — must succeed cleanly.
  const B = makeAudioStub('B');
  let bStopped = false;
  S.claimPlayback(B, () => { bStopped = true; });

  assert.equal(S._peekCurrentElementForTest(), B);
  assert.equal(bStopped, false);
});
