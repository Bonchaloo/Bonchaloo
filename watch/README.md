# watch

A config-driven browser watcher. It loads pages in a real Chromium, pulls a value
out of each one, and commits the result back to this repo. When a value moves, it
opens an issue (and posts to Slack, if a webhook is configured).

Because every result is committed, the repo becomes the database: `history/` is a
time series of every value ever seen, and `snapshots/` is a visual record of the
page at each change.

It exists because some things have no API — a broker's spec page, a changelog, a
dashboard behind JavaScript. A real browser is the only reliable way to read them.

## Adding a target

Everything lives in [`targets.json`](targets.json):

```json
{
  "id": "gold-spread",
  "url": "https://example.broker/specs/xauusd",
  "waitForSelector": "[data-field='spread']",
  "extract": { "type": "text", "selector": "[data-field='spread']" },
  "enabled": true
}
```

`id` names the state, history and snapshot files, so keep it stable — renaming it
starts the history over.

### Extractors

| type | reads | fields |
| --- | --- | --- |
| `title` | the page title | — |
| `text` | text of the first match | `selector` |
| `texts` | text of every match, as a list | `selector`, `limit` |
| `attr` | an attribute of the first match | `selector`, `attribute` |
| `count` | how many elements match | `selector` |
| `script` | whatever the function returns | `body` |

`script` runs its `body` inside the page, so a target can do anything the page's
own JavaScript can. It must return JSON-serialisable data. Treat `targets.json`
as trusted code, because that is what it is.

### Pages that render late

`waitForSelector` blocks until the element exists; `settleMs` adds a fixed pause
after that, for values that arrive over a websocket a beat later. Reach for
`waitForSelector` first — a fixed sleep is a race you will lose eventually.

## Running it

```bash
npm ci
npx playwright install chromium   # not needed in the Claude Code cloud container
npm run watch                     # check every enabled target
node run.mjs --only canary        # check one
node run.mjs --dry-run            # check, print, write nothing
npm run selftest                  # end-to-end check against a local fixture
```

### In the Claude Code cloud container

The container has Chromium at `/opt/pw-browsers/chromium`, and `lib/browser.mjs`
finds it automatically — its revision will not match the one the installed
Playwright expects, so it has to be pointed at explicitly. Two things to know:

- **Egress is allowlisted.** Only GitHub and the package registries are
  reachable; anything else fails with `ERR_TUNNEL_CONNECTION_FAILED` (the proxy
  returns 403). Real targets are checked in CI, not here. `npm run selftest`
  serves its own page on loopback so it works regardless.
- **Chromium does not trust the proxy's CA**, so even allowed HTTPS hosts fail
  with `ERR_CERT_AUTHORITY_INVALID` in the browser, though `curl` to those hosts
  is fine.

Local development against real sites needs the environment's network policy
widened — see the [Claude Code on the web docs](https://code.claude.com/docs/en/claude-code-on-the-web).

## The scheduled run

[`.github/workflows/watch.yml`](../.github/workflows/watch.yml) runs every 6
hours, and on demand via **Actions → Watch → Run workflow**. GitHub only honours
`schedule` and shows `workflow_dispatch` for workflows on the default branch, so
this stays dormant until the branch is merged.

Each run installs Chromium, checks every enabled target, writes a summary table
to the job page, and commits anything that moved. If a value changed it opens an
issue with the before and after. Set a `SLACK_WEBHOOK_URL` repository secret and
it posts there too; without the secret that step is skipped.

A run never fails just because a page did — a cron that goes red on every flaky
site is a cron nobody reads. Failures are recorded in `state/<id>.json` with a
`consecutiveFailures` count, which is the number worth alerting on. Pass
`--strict` to exit non-zero on failure instead.

## Output

| path | what it holds |
| --- | --- |
| `state/<id>.json` | latest value, hash, HTTP status, consecutive failures |
| `history/<id>.ndjson` | one line per run, appended forever |
| `snapshots/<id>.png` | the page as of the last change |
| `last-run.json` | the whole most recent run, used by the workflow |

Snapshots are only rewritten when the extracted value changes, so the repo does
not grow by a screenshot every six hours.
