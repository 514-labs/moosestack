import path from "node:path";
import type * as vscode from "vscode";

import { COMMANDS, normalizePath } from "./constants";

export interface GetStartedProjectData {
  createdAt: string;
  initStdout: string;
  projectName: string;
  projectRoot: string;
  templateName: string;
}

const GET_STARTED_PANEL_TITLE = "Get started with your MooseStack Project";
const PENDING_GET_STARTED_KEY = "fiveonefour.pendingGetStartedProjects";
const MAX_CAPTURED_STDOUT_LENGTH = 20_000;
const ANSI_ESCAPE_PATTERN = /[\u001B\u009B]\[[0-?]*[ -/]*[@-~]/g;
const MOOSESTACK_DOCS_URL = "https://docs.fiveonefour.com/moosestack";
const HOSTING_DOCS_URL = "https://docs.fiveonefour.com/hosting";

function getVscodeApi(): typeof import("vscode") {
  return require("vscode") as typeof import("vscode");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripAnsi(stdout: string): string {
  return stdout.replaceAll(ANSI_ESCAPE_PATTERN, "");
}

function extractGetStartedInstructions(stdout: string): string {
  const normalized = stripAnsi(stdout).replaceAll("\r\n", "\n");
  const markerMatch = normalized.match(/^\s*Get Started\s*$/im);
  const relevantOutput =
    markerMatch && markerMatch.index !== undefined ?
      normalized
        .slice(markerMatch.index + markerMatch[0].length)
        .split("\n")
        .filter((line) => !/^\s*-{5,}\s*$/.test(line))
        .join("\n")
    : normalized;

  return relevantOutput.replaceAll(/\n{3,}/g, "\n\n").trim();
}

function truncateStdout(stdout: string): string {
  const trimmed = extractGetStartedInstructions(stdout);
  if (!trimmed) {
    return "Project scaffolded successfully.";
  }

  if (trimmed.length <= MAX_CAPTURED_STDOUT_LENGTH) {
    return trimmed;
  }

  return `${trimmed.slice(0, MAX_CAPTURED_STDOUT_LENGTH)}\n\n...[truncated]`;
}

export function createGetStartedProjectData(
  projectRoot: string,
  projectName: string,
  templateName: string,
  initStdout: string,
): GetStartedProjectData {
  return {
    createdAt: new Date().toISOString(),
    initStdout: truncateStdout(initStdout),
    projectName,
    projectRoot: normalizePath(projectRoot),
    templateName,
  };
}

export function buildGetStartedPanelHtml(
  project: GetStartedProjectData,
): string {
  const escapedProjectName = escapeHtml(project.projectName);
  const escapedTemplateName = escapeHtml(project.templateName);
  const escapedProjectRoot = escapeHtml(project.projectRoot);
  const escapedStdout = escapeHtml(project.initStdout);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-fiveonefour';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${GET_STARTED_PANEL_TITLE}</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      body {
        color: #f5f5f0;
        background:
          radial-gradient(circle at top center, rgba(45, 104, 255, 0.16), transparent 26%),
          #050505;
        font-family:
          "SF Pro Display",
          "Inter",
          "Segoe UI",
          sans-serif;
        margin: 0;
        padding: 24px;
      }

      main {
        max-width: 920px;
        margin: 0 auto;
      }

      .hero {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 28px;
        padding: 32px;
        background: linear-gradient(
          180deg,
          rgba(11, 14, 24, 0.98),
          rgba(7, 8, 12, 0.98)
        );
        box-shadow:
          0 24px 80px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      h1 {
        font-size: clamp(2.2rem, 4.2vw, 3.6rem);
        line-height: 1;
        letter-spacing: -0.06em;
        margin: 0 0 14px;
      }

      p {
        line-height: 1.6;
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        border-radius: 999px;
        margin-bottom: 22px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: rgba(245, 245, 240, 0.74);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .tagline {
        margin: 0 0 18px;
        font-size: clamp(2.8rem, 6vw, 5rem);
        line-height: 0.98;
        letter-spacing: -0.07em;
        font-weight: 600;
      }

      .accent {
        color: #2d68ff;
      }

      .hero-copy {
        max-width: 760px;
        margin: 0;
        color: rgba(245, 245, 240, 0.78);
        font-size: 1.05rem;
      }

      .meta {
        color: rgba(245, 245, 240, 0.5);
        margin-top: 16px;
        font-family: var(--vscode-editor-font-family);
      }

      .instructions-panel {
        margin: 18px 0 24px;
        border: 1px solid rgba(45, 104, 255, 0.24);
        border-radius: 24px;
        padding: 22px;
        background:
          linear-gradient(
            180deg,
            rgba(11, 17, 34, 0.96),
            rgba(9, 11, 18, 0.96)
          );
      }

      .section-title {
        margin: 0 0 12px;
        font-size: 1.1rem;
        letter-spacing: -0.02em;
      }

      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 12px;
        margin: 0 0 24px;
      }

      .card {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 16px;
        background: rgba(12, 13, 18, 0.9);
        backdrop-filter: blur(6px);
      }

      .card h2 {
        font-size: 1rem;
        margin: 0 0 8px;
      }

      .product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px;
        margin: 0 0 24px;
      }

      .product-card {
        border: 1px solid rgba(45, 104, 255, 0.14);
        border-radius: 22px;
        padding: 18px;
        background:
          linear-gradient(
            180deg,
            rgba(45, 104, 255, 0.08),
            rgba(255, 255, 255, 0.02)
          ),
          rgba(11, 13, 19, 0.94);
      }

      .product-label {
        color: #7ea6ff;
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      .product-card h2 {
        margin: 10px 0 8px;
        font-size: 1.2rem;
      }

      .product-card p {
        margin: 0 0 14px;
        color: rgba(245, 245, 240, 0.76);
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 0 0 24px;
      }

      button {
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 10px 16px;
        font: inherit;
        cursor: pointer;
        background: #17191f;
        color: #f5f5f0;
        font-weight: 700;
        text-decoration: none;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      button.secondary {
        background: rgba(255, 255, 255, 0.06);
        color: #f5f5f0;
      }

      a.link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #7ea6ff;
        font-weight: 700;
        text-decoration: none;
      }

      a.link:hover,
      a.link:focus-visible {
        text-decoration: underline;
      }

      pre {
        white-space: pre-wrap;
        word-break: break-word;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 20px;
        padding: 16px;
        background: rgba(8, 10, 14, 0.98);
        overflow: auto;
        color: #f5f5f0;
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">Fiveonefour Agent Harness</div>
        <h1>${GET_STARTED_PANEL_TITLE}</h1>
        <p class="tagline">Less data engineering.<br /><span class="accent">More shipping.</span></p>
        <p class="hero-copy">
          <strong>${escapedProjectName}</strong> is ready. Fiveonefour scaffolded your
          MooseStack project from the <strong>${escapedTemplateName}</strong> template and
          pulled together the exact next steps below.
        </p>
        <p class="meta">${escapedProjectRoot}</p>
      </section>

      <section class="instructions-panel">
        <h2 class="section-title">Getting Started Instructions</h2>
        <pre>${escapedStdout}</pre>
      </section>

      <section class="product-grid">
        <article class="product-card">
          <div class="product-label">Open Source</div>
          <h2>MooseStack</h2>
          <p>Explore the OLAP-native dev harness, quickstart guides, and core docs for local development.</p>
          <a class="link" href="#" data-link="${MOOSESTACK_DOCS_URL}">Open MooseStack docs</a>
        </article>
        <article class="product-card">
          <div class="product-label">Cloud</div>
          <h2>Fiveonefour Hosting</h2>
          <p>Learn the hosted workflow, deployment commands, environment setup, and integrations.</p>
          <a class="link" href="#" data-link="${HOSTING_DOCS_URL}">Open Hosting docs</a>
        </article>
      </section>

      <section class="grid">
        <article class="card">
          <h2>1. Start local development</h2>
          <p>Launch <code>moose dev</code> in this project and keep the terminal open while you build.</p>
        </article>
        <article class="card">
          <h2>2. Check your editor setup</h2>
          <p>Use Fiveonefour setup status to confirm workspace config, CLI setup, and project discovery.</p>
        </article>
        <article class="card">
          <h2>3. Review the getting started instructions</h2>
          <p>The relevant post-scaffold guidance from <code>moose init</code> is preserved below for quick reference.</p>
        </article>
      </section>

      <section class="actions">
        <button type="button" data-command="startDev">Start moose dev</button>
        <button type="button" class="secondary" data-link="${MOOSESTACK_DOCS_URL}">MooseStack docs</button>
        <button type="button" class="secondary" data-link="${HOSTING_DOCS_URL}">Hosting docs</button>
        <button type="button" class="secondary" data-command="showSetupStatus">Show setup status</button>
        <button type="button" class="secondary" data-command="openOutput">Open Fiveonefour output</button>
      </section>

    </main>

    <script nonce="fiveonefour">
      const vscode = acquireVsCodeApi();
      for (const element of document.querySelectorAll("[data-command], [data-link]")) {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          const command = element.getAttribute("data-command");
          const url = element.getAttribute("data-link");
          vscode.postMessage({ command, url });
        });
      }
    </script>
  </body>
</html>`;
}

export function consumePendingGetStartedProject(
  entries: readonly GetStartedProjectData[],
  workspaceRoots: readonly string[],
): {
  matched: GetStartedProjectData | null;
  remaining: GetStartedProjectData[];
} {
  const normalizedWorkspaceRoots = new Set(workspaceRoots.map(normalizePath));
  const remaining: GetStartedProjectData[] = [];
  let matched: GetStartedProjectData | null = null;

  for (const entry of entries) {
    if (
      !matched &&
      normalizedWorkspaceRoots.has(normalizePath(entry.projectRoot))
    ) {
      matched = entry;
      continue;
    }

    remaining.push(entry);
  }

  return { matched, remaining };
}

export async function queuePendingGetStartedProject(
  context: vscode.ExtensionContext,
  project: GetStartedProjectData,
): Promise<void> {
  const entries =
    context.globalState.get<GetStartedProjectData[]>(PENDING_GET_STARTED_KEY) ??
    [];

  const dedupedEntries = entries.filter(
    (entry) =>
      normalizePath(entry.projectRoot) !== normalizePath(project.projectRoot),
  );

  dedupedEntries.push(project);
  await context.globalState.update(PENDING_GET_STARTED_KEY, dedupedEntries);
}

export async function showPendingGetStartedProject(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): Promise<boolean> {
  const vscodeApi = getVscodeApi();
  const entries =
    context.globalState.get<GetStartedProjectData[]>(PENDING_GET_STARTED_KEY) ??
    [];
  if (entries.length === 0) {
    return false;
  }

  const workspaceRoots = (vscodeApi.workspace.workspaceFolders ?? []).map(
    (workspaceFolder) => workspaceFolder.uri.fsPath,
  );
  const { matched, remaining } = consumePendingGetStartedProject(
    entries,
    workspaceRoots,
  );

  if (!matched) {
    return false;
  }

  await context.globalState.update(PENDING_GET_STARTED_KEY, remaining);
  showGetStartedPanel(context, outputChannel, matched);
  return true;
}

export function showGetStartedPanel(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  project: GetStartedProjectData,
): void {
  const vscodeApi = getVscodeApi();
  const panel = vscodeApi.window.createWebviewPanel(
    "fiveonefour.getStartedProject",
    GET_STARTED_PANEL_TITLE,
    vscodeApi.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
    },
  );

  panel.webview.html = buildGetStartedPanelHtml(project);
  panel.webview.onDidReceiveMessage(
    async (message: unknown) => {
      if (
        typeof message !== "object" ||
        message === null ||
        !("command" in message || "url" in message)
      ) {
        return;
      }

      const command = (message as { command?: unknown }).command;
      const url = (message as { url?: unknown }).url;
      if (typeof url === "string" && url.length > 0) {
        await vscodeApi.env.openExternal(vscodeApi.Uri.parse(url));
        return;
      }

      if (command === "openOutput") {
        outputChannel.show(true);
        return;
      }

      if (command === "showSetupStatus") {
        await vscodeApi.commands.executeCommand(COMMANDS.showSetupStatus);
        return;
      }

      if (command === "startDev") {
        const terminal = vscodeApi.window.createTerminal({
          cwd: project.projectRoot,
          name: `moose dev: ${path.basename(project.projectRoot)}`,
        });
        terminal.show();
        terminal.sendText("moose dev", true);
      }
    },
    undefined,
    context.subscriptions,
  );
}
