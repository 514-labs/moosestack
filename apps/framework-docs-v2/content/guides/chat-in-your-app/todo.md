# Chat-in-Your-App Guide — To-Do List

Branch: `chat-app-guide-update`

Reference material:
- Demo repo: `~/code/demo/financial-query-layer-demo/`
- Blog: https://clickhouse.com/blog/metrics-layer-with-fiveonefour
- Performant Dashboards guide (stepper reference): `content/guides/performant-dashboards/tutorial.mdx`

---

## 1. Fix Configurator

- [x] Verify configurator UI renders and persists correctly on the tutorial page
- [x] Update labels: professional naming (New MooseStack project / Add to existing Next.js app)
- [x] Add chipLabels (New Project / Existing App)
- [ ] Check `whenId`/`whenValue` keys match config IDs — config uses `startingPoint` (camelCase) but content uses `starting-point` (kebab-case) — potential mismatch
- [ ] Ensure settings are visible/accessible to the user on the tutorial page

## 2. Fix "Steps"

- [x] Merge `chat-project-setup` and `chat-dev-harness` into "Project and Dev Harness Setup"
- [x] Redraft intro (BulletPointsCard, CommunityCallout, numbered sections)
- [x] Prerequisites folded into first stepper checkpoint
- [x] Install CLI step (moose,514)
- [x] moose init step with collapsible post-init instructions
- [x] 514 agent init step (MooseStack Skills + LSP)
- [x] "Restart your coding agent" checkpoint
- [x] Dev harness complete callout
- [ ] Decide: unify into one stepper or keep multi-stepper? (each resets numbering at 1)
- [ ] Fix step numbering if keeping multi-stepper (confusing UX)
- [ ] Review overall flow — is the progression clear to a new user?

## 2.5 Generalize "Model and Load Your Data" section

- [x] Remove S3-as-requirement framing
- [x] Generalize to cover multiple ingestion patterns (flat file, push API, pull workflow)
- [x] Keep Amazon Customer Reviews as optional sample dataset in ToggleBlock
- [x] Amazon OlapTable example in ToggleBlock
- [x] MV callout for pre-aggregation

## 3. Add Query Layer Steps

- [x] New intro with rationale and architecture diagram (query-layer.png)
- [x] "Identify patterns" step
- [x] Prompt-based defineQueryModel step with code block prompt
- [x] "Review the generated query model" checkpoint with full Amazon example in ToggleBlock
- [x] "Use query model in APIs and tools" checkpoint with collapsible ToggleBlocks (MCP, Chat, REST)
- [x] amazon-query.png screenshot showing metrics propagated to chat
- [x] Deleted old queryFn/params/result API pattern
- [x] Deleted serving table checkpoint (noted MV in part 1 instead)
- [x] Deleted appendix (Data context as code)

## 4. Dashboard and Query Builder (Optional)

- [x] Section intro explaining query builder concept + auto-update with new metrics
- [x] Dashboard step: shadcn chart prompt, CORS warning, amazon-dash.png screenshot
- [x] Query builder step: two-endpoint pattern (/schema + /metrics) with reference prompt
- [ ] Add screenshot of query builder UI once demo is built

## 5. Deploy section

- [ ] Add deployment-specific prerequisites to WhatYouNeed:
  - Fiveonefour hosting account (https://www.boreal.cloud/sign-in)
  - Vercel account (https://vercel.com/)
  - GitHub account (if not already mentioned)
- [ ] Review deploy steps for completeness
