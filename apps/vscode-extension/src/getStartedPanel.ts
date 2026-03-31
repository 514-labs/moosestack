import crypto from "node:crypto";
import type * as vscode from "vscode";

import {
  COMMANDS,
  EXTENSION_BRAND,
  HARNESS_INIT_COMMAND,
  MOOSESTACK_DOCS_URL,
  SUPPORT_URL,
} from "./constants";
import { getVscodeApi } from "./vscodeApi";

const PANEL_ID = "fiveonefour.harnessGuide";
const PANEL_TITLE = "Create a Moose Harness Project";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildHarnessSplashHtml(
  nonce = crypto.randomUUID().replaceAll("-", ""),
): string {
  const escapedBrand = escapeHtml(EXTENSION_BRAND);
  const escapedHarnessCommand = escapeHtml(HARNESS_INIT_COMMAND);
  const escapedDocsUrl = escapeHtml(MOOSESTACK_DOCS_URL);
  const escapedNonce = escapeHtml(nonce);
  const escapedSupportUrl = escapeHtml(SUPPORT_URL);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${escapedNonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${PANEL_TITLE}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #0b0d12;
        --panel: rgba(16, 20, 30, 0.94);
        --panel-border: rgba(255, 255, 255, 0.08);
        --muted: rgba(239, 240, 244, 0.72);
        --text: #f5f7fb;
        --accent: #48d3a7;
        --accent-2: #7fd8ff;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(72, 211, 167, 0.18), transparent 28%),
          radial-gradient(circle at top right, rgba(127, 216, 255, 0.12), transparent 30%),
          linear-gradient(180deg, #0b0d12 0%, #07090d 100%);
        font-family:
          "SF Pro Display",
          "Inter",
          "Segoe UI",
          sans-serif;
      }

      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 32px 24px 48px;
      }

      .hero,
      .grid,
      .actions {
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        background: var(--panel);
        box-shadow:
          0 24px 72px rgba(0, 0, 0, 0.28),
          inset 0 1px 0 rgba(255, 255, 255, 0.04);
      }

      .hero {
        padding: 32px;
        margin-bottom: 18px;
      }

      .eyebrow {
        display: inline-flex;
        margin-bottom: 20px;
        padding: 6px 12px;
        border-radius: 999px;
        background: rgba(72, 211, 167, 0.12);
        color: var(--accent);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.6rem, 6vw, 4.8rem);
        line-height: 0.96;
        letter-spacing: -0.07em;
      }

      .lede {
        max-width: 760px;
        margin: 0;
        color: var(--muted);
        font-size: 1.04rem;
        line-height: 1.7;
      }

      .command-block {
        margin-top: 24px;
        border-radius: 22px;
        padding: 18px 20px;
        background: rgba(7, 10, 14, 0.96);
        border: 1px solid rgba(127, 216, 255, 0.16);
      }

      .command-label {
        color: var(--accent-2);
        font-size: 0.8rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        font-weight: 700;
      }

      code {
        display: block;
        margin-top: 10px;
        font-size: 1.2rem;
        line-height: 1.4;
        color: #f8fafc;
        font-family: var(--vscode-editor-font-family, "SFMono-Regular", monospace);
      }

      .grid {
        display: grid;
        gap: 14px;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        padding: 18px;
        margin-bottom: 18px;
      }

      .card {
        border-radius: 20px;
        padding: 18px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.05);
      }

      .card h2 {
        margin: 0 0 10px;
        font-size: 1rem;
        letter-spacing: -0.02em;
      }

      .card p {
        margin: 0;
        color: var(--muted);
        line-height: 1.65;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 18px;
      }

      button {
        appearance: none;
        border: none;
        border-radius: 999px;
        padding: 11px 16px;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
        color: #04110c;
        background: linear-gradient(135deg, #48d3a7, #7fd8ff);
      }

      button.secondary {
        color: var(--text);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      @media (max-width: 720px) {
        main {
          padding: 24px 16px 40px;
        }

        .hero,
        .grid,
        .actions {
          border-radius: 24px;
        }

        .hero {
          padding: 24px;
        }

        .actions {
          flex-direction: column;
        }

        button {
          width: 100%;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">${escapedBrand} Harness Guide</div>
        <h1>Create a Moose Harness project.</h1>
        <p class="lede">
          ${escapedBrand} keeps the Moose and 514 CLIs installed and current in the background.
          Once that is healthy, start a new Moose Harness project from any terminal with the command below.
        </p>
        <div class="command-block">
          <div class="command-label">Current harness command</div>
          <code>${escapedHarnessCommand}</code>
        </div>
      </section>

      <section class="grid">
        <article class="card">
          <h2>1. Pick a directory</h2>
          <p>Open a terminal in the parent directory where you want the new Harness project to live.</p>
        </article>
        <article class="card">
          <h2>2. Run the init command</h2>
          <p>Execute <code>${escapedHarnessCommand}</code> and follow the prompts to scaffold the project.</p>
        </article>
        <article class="card">
          <h2>3. Windows note</h2>
          <p>Fiveonefour supports Windows through WSL. Native Windows does not run the installer flow.</p>
        </article>
      </section>

      <section class="actions">
        <button type="button" data-command="copyHarnessCommand">Copy moose init</button>
        <button type="button" class="secondary" data-link="${escapedDocsUrl}">Open MooseStack docs</button>
        <button type="button" class="secondary" data-link="${escapedSupportUrl}">Open support</button>
        <button type="button" class="secondary" data-command="checkInstallState">Check install state</button>
        <button type="button" class="secondary" data-command="openOutput">Open Fiveonefour output</button>
      </section>
    </main>

    <script nonce="${escapedNonce}">
      const vscode = acquireVsCodeApi();
      for (const element of document.querySelectorAll("[data-command], [data-link]")) {
        element.addEventListener("click", (event) => {
          event.preventDefault();
          vscode.postMessage({
            command: element.getAttribute("data-command"),
            url: element.getAttribute("data-link"),
          });
        });
      }
    </script>
  </body>
</html>`;
}

export function showHarnessSplashPanel(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
): void {
  const vscodeApi = getVscodeApi();
  const panel = vscodeApi.window.createWebviewPanel(
    PANEL_ID,
    PANEL_TITLE,
    vscodeApi.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
    },
  );
  panel.webview.html = buildHarnessSplashHtml();
  panel.webview.onDidReceiveMessage(
    async (message: unknown) => {
      if (typeof message !== "object" || message === null) {
        return;
      }

      const command = (message as { command?: unknown }).command;
      const url = (message as { url?: unknown }).url;

      if (typeof url === "string" && url.length > 0) {
        await vscodeApi.env.openExternal(vscodeApi.Uri.parse(url));
        return;
      }

      if (command === "copyHarnessCommand") {
        await vscodeApi.env.clipboard.writeText(HARNESS_INIT_COMMAND);
        void vscodeApi.window.showInformationMessage(
          "Copied `moose init` to the clipboard.",
        );
        return;
      }

      if (command === "checkInstallState") {
        await vscodeApi.commands.executeCommand(COMMANDS.checkInstallState);
        return;
      }

      if (command === "openOutput") {
        outputChannel.show(true);
      }
    },
    undefined,
    context.subscriptions,
  );
}
