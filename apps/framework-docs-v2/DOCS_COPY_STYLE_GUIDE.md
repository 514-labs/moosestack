# Docs Copy Style Guide (MooseStack)

This guide defines the default writing standard for MooseStack docs and onboarding README surfaces.

## Goals

- Get readers to a first successful run fast.
- Make every page skimmable and trustworthy.
- Keep TypeScript and Python parity on onboarding paths.
- Keep naming and links consistent across docs + templates + READMEs.

## Audience

- Engineers evaluating MooseStack (solution-aware / product-aware).
- Engineers implementing MooseStack in an existing codebase.

## Voice And Tone (Zinsser Default)

- Be direct. Prefer short sentences.
- Use active voice and concrete verbs.
- Remove filler: “This guide will…”, “In order to…”, “Simply…”.
- Prefer “you” and “do X” over passive descriptions.
- Don’t oversell. Use specific outcomes and observable checkpoints.

## Entrypoints (Schwartz, Used Selectively)

Use Schwartz-style framing only on:

- `apps/framework-docs-v2/content/moosestack/index.mdx`
- Getting started index + quickstart pages
- Root `README.md`
- Template READMEs

Rules:

- First 20% of the page should answer: what it is, who it’s for, what you’ll have when done.
- One primary CTA per page (usually Quickstart or “existing ClickHouse”).
- Proof beats adjectives: show output, show a directory tree, show a `curl` response.

## Canonical Naming

- Product: “MooseStack”
- CLI product name: “Moose CLI”
- CLI command: `moose`
- TypeScript: “TypeScript” (not “Typescript”)
- Python: “Python”
- ClickHouse, Redpanda, Temporal, Redis, Docker Desktop

## Page Structure (Onboarding Pages)

Use this order unless there’s a strong reason not to:

1. Promise (1–2 sentences)
2. Prerequisites (with a quick verification command)
3. Steps (numbered; copy-pasteable)
4. Checkpoints (what you should see)
5. Troubleshooting (common failures + fixes)
6. Next steps (links)

## Language Parity

- If a page is an onboarding step, it must include both TypeScript and Python.
- Prefer `LanguageTabs` or mirrored “TypeScript” / “Python” sections.
- Keep steps aligned (same headings, same order, same checkpoints).

## Links

- Inside docs content, prefer site-relative links: `/moosestack/...`.
- In repo READMEs and templates, prefer canonical absolute links: `https://docs.fiveonefour.com/moosestack/...`.
- Avoid legacy patterns:
  - `docs.fiveonefour.com/moose/...`
  - `/moose/...`
  - `github.com/514-labs/moose/...`

If a legacy link must remain, label it clearly as legacy and explain why.

## Verification Checkpoints

Every “do something” section should include at least one checkpoint, for example:

- `curl http://localhost:4000/health`
- “You should see: `✓ ClickHouse is ready`”
- “You should see an OpenAPI page at …” (only if we’re confident of the URL)

