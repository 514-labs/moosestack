import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGetStartedPanelHtml,
  consumePendingGetStartedProject,
  createGetStartedProjectData,
} from "../src/getStartedPanel";

test("createGetStartedProjectData normalizes paths, strips ANSI, and keeps only the get-started section", () => {
  const project = createGetStartedProjectData(
    "/repo/../repo/project",
    "project",
    "typescript",
    [
      "\u001b[38;5;10mCreated\u001b[0m template",
      "",
      "\u001b[48;5;10m\u001b[1m    Get Started \u001b[0m",
      "",
      "Deploy on Boreal",
      "",
      "-----",
      "",
      "cd project",
      "moose dev",
    ].join("\n"),
  );

  assert.equal(project.projectRoot, "/repo/project");
  assert.equal(project.initStdout, "Deploy on Boreal\n\ncd project\nmoose dev");
  assert.equal(project.projectName, "project");
});

test("buildGetStartedPanelHtml escapes scaffold output and renders the title", () => {
  const html = buildGetStartedPanelHtml(
    createGetStartedProjectData(
      "/repo/project",
      "project",
      "typescript",
      "<script>alert('xss')</script>",
    ),
  );

  assert.match(html, /Get started with your MooseStack Project/);
  assert.match(html, /Less data engineering\./);
  assert.match(html, /More shipping\./);
  assert.match(html, /Open MooseStack docs/);
  assert.match(html, /Open Hosting docs/);
  assert.match(html, /https:\/\/docs\.fiveonefour\.com\/moosestack/);
  assert.match(html, /https:\/\/docs\.fiveonefour\.com\/hosting/);
  assert.match(html, /&lt;script&gt;alert\(&#39;xss&#39;\)&lt;\/script&gt;/);
  assert.match(html, /Start moose dev/);
  assert.match(html, /Getting Started Instructions/);
  assert.doesNotMatch(html, /Open fiveonefour\.com/);
});

test("buildGetStartedPanelHtml uses a per-panel CSP nonce", () => {
  const html = buildGetStartedPanelHtml(
    createGetStartedProjectData("/repo/project", "project", "typescript", "ok"),
  );

  const cspNonceMatch = html.match(/script-src 'nonce-([^']+)'/);
  const scriptNonceMatch = html.match(/<script nonce="([^"]+)">/);

  assert.ok(cspNonceMatch);
  assert.ok(scriptNonceMatch);
  assert.equal(cspNonceMatch[1], scriptNonceMatch[1]);
  assert.notEqual(cspNonceMatch[1], "fiveonefour");
});

test("consumePendingGetStartedProject matches the current workspace root", () => {
  const first = createGetStartedProjectData("/repo/a", "a", "typescript", "ok");
  const second = createGetStartedProjectData("/repo/b", "b", "python", "ok");

  const { matched, remaining } = consumePendingGetStartedProject(
    [first, second],
    ["/repo/b"],
  );

  assert.equal(matched?.projectRoot, "/repo/b");
  assert.deepEqual(
    remaining.map((entry) => entry.projectRoot),
    ["/repo/a"],
  );
});
