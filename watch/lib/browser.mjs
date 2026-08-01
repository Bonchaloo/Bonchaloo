import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

// Chromium that ships with the Claude Code cloud container. Its revision rarely
// matches the one the installed Playwright expects, so it has to be pointed at
// explicitly rather than resolved from PLAYWRIGHT_BROWSERS_PATH.
const CONTAINER_CHROMIUM = '/opt/pw-browsers/chromium';

function resolveExecutablePath() {
  if (process.env.PW_EXECUTABLE_PATH) return process.env.PW_EXECUTABLE_PATH;
  if (existsSync(CONTAINER_CHROMIUM)) return CONTAINER_CHROMIUM;
  return undefined; // CI: let Playwright use the browser it installed itself
}

export async function launchBrowser() {
  const executablePath = resolveExecutablePath();
  const options = { args: [] };

  if (executablePath) {
    options.executablePath = executablePath;
    // The container runs as root, where Chromium's sandbox cannot start. Without
    // this it hangs on launch rather than failing.
    options.args.push('--no-sandbox', '--disable-dev-shm-usage');
  }

  // Egress in the container is proxied; in CI there is no proxy to honour.
  const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxyUrl) {
    options.proxy = { server: proxyUrl };
    const noProxy = process.env.NO_PROXY || process.env.no_proxy;
    // Chromium wants comma-or-semicolon separated hosts; sending loopback through
    // the proxy would break local fixtures and any locally served target.
    if (noProxy) options.proxy.bypass = noProxy;
  }

  return chromium.launch(options);
}

export function describeBrowserEnv() {
  const executablePath = resolveExecutablePath();
  return {
    executablePath: executablePath ?? '(playwright-managed)',
    proxy: process.env.HTTPS_PROXY || process.env.https_proxy || '(none)',
  };
}
