# Docs PR Checklist (MooseStack)

Use this checklist for any docs PR that touches onboarding pages, templates, or user-facing READMEs.

## Copy

- [ ] I ran a Zinsser pass: removed filler, tightened sentences, used concrete verbs.
- [ ] If this is an entrypoint page, I applied Schwartz framing in the first 20% (promise + proof + single CTA).
- [ ] Terminology matches the canonical naming (MooseStack, Moose CLI, `moose`, TypeScript, ClickHouse).
- [ ] Steps are copy-pasteable and include at least one checkpoint (“you should see…”).

## Parity

- [ ] TypeScript + Python parity is present for onboarding pages (tabs or mirrored sections).
- [ ] Code and commands match current repo tooling (pnpm for TypeScript templates, Python 3.12+ for Python templates).

## Links

- [ ] No legacy docs links: `docs.fiveonefour.com/moose/...` or `/moose/...` (unless explicitly labeled legacy).
- [ ] GitHub links point to `github.com/514-labs/moosestack` (not `.../moose`).

## Validation

- [ ] `pnpm -C apps/framework-docs-v2 validate:includes`
- [ ] `pnpm -C apps/framework-docs-v2 test:snippets`
- [ ] `pnpm -C apps/framework-docs-v2 build`

## Tracking

- [ ] I updated `apps/framework-docs-v2/COPY_AUDIT.md` for any P0/P1 surfaces touched.

