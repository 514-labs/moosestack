import assert from "node:assert/strict";
import test from "node:test";

import { buildHarnessSplashHtml } from "../src/getStartedPanel";

test("buildHarnessSplashHtml renders the harness command and support links", () => {
  const html = buildHarnessSplashHtml();

  assert.match(html, /Create a Moose Harness Project/);
  assert.match(html, /moose init/);
  assert.match(html, /Open MooseStack docs/);
  assert.match(html, /Open support/);
  assert.match(html, /Windows through WSL/);
  assert.match(html, /https:\/\/docs\.fiveonefour\.com\/moosestack/);
  assert.match(html, /http:\/\/slack\.moosestack\.com\//);
});

test("buildHarnessSplashHtml uses a per-panel CSP nonce", () => {
  const html = buildHarnessSplashHtml();

  const cspNonceMatch = html.match(/script-src 'nonce-([^']+)'/);
  const scriptNonceMatch = html.match(/<script nonce="([^"]+)">/);

  assert.ok(cspNonceMatch);
  assert.ok(scriptNonceMatch);
  assert.equal(cspNonceMatch[1], scriptNonceMatch[1]);
  assert.notEqual(cspNonceMatch[1], "fiveonefour");
});
