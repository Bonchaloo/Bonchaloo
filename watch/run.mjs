#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describeBrowserEnv, launchBrowser } from './lib/browser.mjs';
import { extractValue } from './lib/extract.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIRS = {
  state: path.join(ROOT, 'state'),
  history: path.join(ROOT, 'history'),
  snapshots: path.join(ROOT, 'snapshots'),
};

const args = parseArgs(process.argv.slice(2));

const configPath = args.config ? path.resolve(args.config) : path.join(ROOT, 'targets.json');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const defaults = {
  waitUntil: 'domcontentloaded',
  timeout: 30000,
  screenshot: true,
  fullPage: false,
  viewport: { width: 1280, height: 800 },
  ...(config.defaults ?? {}),
};

const targets = (config.targets ?? [])
  .filter((t) => t.enabled !== false)
  .filter((t) => (args.only ? args.only.includes(t.id) : true));

if (targets.length === 0) {
  console.log('No enabled targets to check. Add one to watch/targets.json.');
  process.exit(0);
}

await Promise.all(Object.values(DIRS).map((dir) => mkdir(dir, { recursive: true })));

const env = describeBrowserEnv();
console.log(`chromium: ${env.executablePath}`);
console.log(`proxy:    ${env.proxy}`);
console.log(`checking ${targets.length} target(s)${args.dryRun ? ' (dry run)' : ''}\n`);

const browser = await launchBrowser();
const results = [];

for (const target of targets) {
  results.push(await check(browser, { ...defaults, ...target }));
}

await browser.close();

const summary = {
  checkedAt: new Date().toISOString(),
  total: results.length,
  changed: results.filter((r) => r.status === 'changed').length,
  errors: results.filter((r) => r.status === 'error').length,
  results,
};

if (!args.dryRun) {
  await writeFile(path.join(ROOT, 'last-run.json'), `${JSON.stringify(summary, null, 2)}\n`);
}

report(summary);

// A watcher that exits non-zero on every flaky page turns a cron into an alarm
// nobody reads. Failures are recorded in state; --strict is opt-in for CI gating.
process.exit(args.strict && summary.errors > 0 ? 1 : 0);

async function check(browser, target) {
  const startedAt = Date.now();
  const context = await browser.newContext({
    viewport: target.viewport,
    userAgent: target.userAgent,
  });
  const page = await context.newPage();

  try {
    const response = await page.goto(target.url, {
      waitUntil: target.waitUntil,
      timeout: target.timeout,
    });

    if (target.waitForSelector) {
      await page.locator(target.waitForSelector).first().waitFor({ timeout: target.timeout });
    }
    if (target.settleMs) {
      await page.waitForTimeout(target.settleMs);
    }

    const value = await extractValue(page, target.extract);
    const previous = await readState(target.id);
    const valueHash = hash(value);
    const status = !previous ? 'new' : previous.valueHash === valueHash ? 'unchanged' : 'changed';

    const result = {
      id: target.id,
      url: target.url,
      status,
      value,
      valueHash,
      previousValue: previous?.value ?? null,
      httpStatus: response?.status() ?? null,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };

    // Snapshots are only worth the repo churn when something actually moved.
    if (target.screenshot && !args.dryRun && (status !== 'unchanged' || !existsSync(snapshotPath(target.id)))) {
      await page.screenshot({ path: snapshotPath(target.id), fullPage: target.fullPage });
      result.snapshot = path.relative(ROOT, snapshotPath(target.id));
    }

    if (!args.dryRun) await persist(target.id, result);
    return result;
  } catch (error) {
    const previous = await readState(target.id);
    const result = {
      id: target.id,
      url: target.url,
      status: 'error',
      error: error.message.split('\n')[0],
      value: previous?.value ?? null,
      valueHash: previous?.valueHash ?? null,
      consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
      durationMs: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    };
    if (!args.dryRun) await persist(target.id, result);
    return result;
  } finally {
    await context.close();
  }
}

async function persist(id, result) {
  const state = { ...result };
  if (result.status !== 'error') state.consecutiveFailures = 0;
  delete state.previousValue;

  await writeFile(path.join(DIRS.state, `${id}.json`), `${JSON.stringify(state, null, 2)}\n`);
  await appendFile(
    path.join(DIRS.history, `${id}.ndjson`),
    `${JSON.stringify({
      checkedAt: result.checkedAt,
      status: result.status,
      value: result.value,
      error: result.error ?? null,
    })}\n`,
  );
}

async function readState(id) {
  const file = path.join(DIRS.state, `${id}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function snapshotPath(id) {
  return path.join(DIRS.snapshots, `${id}.png`);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
}

function report(summary) {
  const icons = { new: '+', changed: '~', unchanged: '=', error: '!' };
  for (const r of summary.results) {
    const detail =
      r.status === 'error'
        ? r.error
        : r.status === 'changed'
          ? `${preview(r.previousValue)} -> ${preview(r.value)}`
          : preview(r.value);
    console.log(`${icons[r.status]} ${r.id.padEnd(24)} ${detail}`);
  }
  console.log(
    `\n${summary.total} checked, ${summary.changed} changed, ${summary.errors} failed`,
  );
}

function preview(value) {
  if (value === null || value === undefined) return '(none)';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function parseArgs(argv) {
  const parsed = { only: null, dryRun: false, strict: false, config: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--only') parsed.only = argv[++i]?.split(',') ?? [];
    else if (argv[i] === '--config') parsed.config = argv[++i] ?? null;
    else if (argv[i] === '--dry-run') parsed.dryRun = true;
    else if (argv[i] === '--strict') parsed.strict = true;
  }
  return parsed;
}
