#!/usr/bin/env node
/**
 * The page visibility of Memora's WebView, for the trial (trial.sh), read over the Chrome
 * DevTools Protocol. MainActivity enables WebView debugging, so after
 * `adb forward tcp:<port> localabstract:webview_devtools_remote_<app pid>` the page answers on
 * 127.0.0.1:<port>.
 *
 *   node page-visibility.mjs <port> watch    prints document.visibilityState, and from then on
 *                                            records the page's visibilitychange events
 *   node page-visibility.mjs <port> state    prints document.visibilityState
 *   node page-visibility.mjs <port> events   prints the events recorded since `watch`
 *                                            ("hidden,visible", or "none")
 *
 * Needs Node.js 22 or later, for its WebSocket.
 */
const [port, mode] = process.argv.slice(2);

const EXPRESSIONS = {
  watch: `(() => {
    if (!window.__trialVisibility) {
      document.addEventListener('visibilitychange', () =>
        window.__trialVisibility.push(document.visibilityState));
    }
    window.__trialVisibility = [];
    return document.visibilityState;
  })()`,
  state: 'document.visibilityState',
  events: `!window.__trialVisibility
    ? 'none recorded: the page has loaded again since watch'
    : window.__trialVisibility.join(',') || 'none'`,
};

function fail(why) {
  console.error(`page-visibility: ${why}`);
  process.exit(1);
}

if (!port || !EXPRESSIONS[mode]) fail('usage: page-visibility.mjs <port> watch|state|events');
if (typeof WebSocket !== 'function') fail('needs Node.js 22 or later, for its WebSocket');
// A frozen app doesn't answer at all.
setTimeout(() => fail('no answer in 5 s'), 5000);

let pages;
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  pages = targets.filter((target) => target.type === 'page');
} catch (error) {
  fail(`no DevTools on port ${port}: ${error.cause?.message ?? error.message}`);
}
// Paths only: the sign-in address carries a secret.
const paths = pages.map((page) => URL.parse(page.url)?.pathname ?? '?').join(' ');
if (pages.length !== 1) fail(`${pages.length} pages instead of one: ${paths}`);

const socket = new WebSocket(`ws://127.0.0.1:${port}/devtools/page/${pages[0].id}`);
socket.addEventListener('error', (event) => fail(`DevTools connection: ${event.message}`));
socket.addEventListener('open', () => {
  const params = { expression: EXPRESSIONS[mode], returnByValue: true };
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params }));
});
socket.addEventListener('message', (event) => {
  const reply = JSON.parse(event.data);
  if (reply.id !== 1) return;
  const value = reply.result?.result?.value;
  if (typeof value !== 'string') fail(`Runtime.evaluate: ${JSON.stringify(reply)}`);
  process.stdout.write(`${value}\n`, () => process.exit(0));
});
