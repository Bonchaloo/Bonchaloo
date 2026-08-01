#!/usr/bin/env node
/**
 * End-to-end check of the watcher against a page served on loopback.
 *
 * Deliberately avoids the public internet: the Claude Code cloud container only
 * has egress to GitHub and the package registries, so a self test that reached
 * out to a real site would fail there for reasons unrelated to this code.
 *
 *   node selftest.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ID = 'selftest';
const PORT = 8787;

let served = 'first value';
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><body><h1>${served}</h1></body></html>`);
});
await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

const workDir = await mkdtemp(path.join(tmpdir(), 'watch-selftest-'));
const configPath = path.join(workDir, 'targets.json');
await writeFile(
  configPath,
  JSON.stringify({
    targets: [
      { id: ID, url: `http://127.0.0.1:${PORT}/`, extract: { type: 'text', selector: 'h1' } },
    ],
  }),
);

const artifacts = [
  path.join(ROOT, 'state', `${ID}.json`),
  path.join(ROOT, 'history', `${ID}.ndjson`),
  path.join(ROOT, 'snapshots', `${ID}.png`),
];
const lastRunPath = path.join(ROOT, 'last-run.json');
const priorLastRun = existsSync(lastRunPath) ? await readFile(lastRunPath, 'utf8') : null;

const failures = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}${ok ? '' : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
  if (!ok) failures.push(label);
};

try {
  await Promise.all(artifacts.map((file) => rm(file, { force: true })));

  let state = await runOnce();
  check('first run is new', state.status, 'new');
  check('first run captures the value', state.value, 'first value');
  check('screenshot written', existsSync(artifacts[2]), true);

  served = 'second value';
  state = await runOnce();
  check('edited page is a change', state.status, 'changed');
  check('change captures new value', state.value, 'second value');

  state = await runOnce();
  check('stable page is unchanged', state.status, 'unchanged');

  const history = (await readFile(artifacts[1], 'utf8')).trim().split('\n');
  check('history has one line per run', history.length, 3);
  check('history is parseable', JSON.parse(history[1]).value, 'second value');
} finally {
  await Promise.all(artifacts.map((file) => rm(file, { force: true })));
  await rm(workDir, { recursive: true, force: true });
  if (priorLastRun === null) await rm(lastRunPath, { force: true });
  else await writeFile(lastRunPath, priorLastRun);
  server.close();
}

console.log(failures.length === 0 ? '\nself test passed' : `\nself test FAILED: ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);

async function runOnce() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['run.mjs', '--config', configPath, '--only', ID], {
      cwd: ROOT,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`run.mjs exited ${code}`))));
  });
  return JSON.parse(await readFile(artifacts[0], 'utf8'));
}
