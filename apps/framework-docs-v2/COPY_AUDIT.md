# MooseStack Docs Copy Audit

This file tracks onboarding-critical copy + link quality across docs v2 and repo entrypoints.

## P0 Surfaces (Onboarding Critical)

| Surface | Path | Status | Notes |
| --- | --- | --- | --- |
| Docs overview | `apps/framework-docs-v2/content/moosestack/index.mdx` | done | Tightened opening, fixed “Moose” phrasing, corrected Python snippet. |
| Getting started landing | `apps/framework-docs-v2/content/moosestack/getting-started/index.mdx` | done | Cleaned microcopy + punctuation. |
| Quickstart | `apps/framework-docs-v2/content/moosestack/getting-started/quickstart.mdx` | done | “Prerequisites” spelling, GitHub issues link. |
| Legacy quickstart route | `apps/framework-docs-v2/next.config.js` | done | Redirect `/moosestack/quickstart` -> `/moosestack/getting-started/quickstart`. |
| Root repo README | `README.md` | done | TypeScript capitalization, quickstart split, corrected Python example. |
| TS template README | `templates/typescript/README.md` | done | Rewritten as runnable checklist; updated docs links. |
| Py template README | `templates/python/README.md` | done | Python 3.12+, removed redundant `moose init`, updated docs links. |
| Empty templates doc links | `templates/typescript-empty/app/index.ts` | done | Updated doc pointers to `/moosestack/...`. |
| Empty templates doc links | `templates/python-empty/app/main.py` | todo | Update doc pointers to `/moosestack/...`. |

## P1 Surfaces (High Impact)

| Surface | Path | Status | Notes |
| --- | --- | --- | --- |
| Static report guide resources | `apps/framework-docs-v2/content/guides/static-report-generation.mdx` | done | Updated legacy links to `/moosestack/...`. |
| Chat-in-your-app resources | `apps/framework-docs-v2/content/guides/chat-in-your-app.mdx` | done | Updated LLM view link + GitHub links. |
| Kafka engine doc link | `apps/framework-docs-v2/content/moosestack/engines/kafka.mdx` | done | Fixed legacy internal link. |
| Template README link modernization | `templates/**/README*.md` | done | Rewrote core READMEs; updated legacy `docs.fiveonefour.com/moose/...` references where found. |

## Process / Quality Gates

| Item | Path | Status | Notes |
| --- | --- | --- | --- |
| Copy style guide | `apps/framework-docs-v2/DOCS_COPY_STYLE_GUIDE.md` | done | Zinsser default, Schwartz entrypoints. |
| Copy brief template | `apps/framework-docs-v2/DOCS_COPY_BRIEF_TEMPLATE.md` | done | Standard rewrite brief. |
| Docs PR checklist | `apps/framework-docs-v2/DOCS_PR_CHECKLIST.md` | done | Checklist for docs PRs. |
| Docs lint script | `apps/framework-docs-v2/scripts/lint-docs.ts` | done | Report-only checks for legacy links, banned phrases, missing metadata, duplicate bodies. |
| Snippet tester content root | `apps/framework-docs-v2/scripts/test-snippets.ts` | done | Scans `apps/framework-docs-v2/content/**`. |
| Docs lint command | `apps/framework-docs-v2/package.json` | done | Replaces unsupported `next lint` with `typecheck` + docs lint. |
