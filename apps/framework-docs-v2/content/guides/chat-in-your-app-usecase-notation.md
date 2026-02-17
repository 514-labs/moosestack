# Chat in Your App Guide - Use Case Notation

Formal use-case notation (per Ottensooser/Fekete et al) for the chat-in-your-app guide.

## Use Case

**PRECONDITIONS:**
- User wants to build data-aware chat
- User has access to ClickHouse data (or will create it)

## Main Success Scenario

1. User reads Overview
   1.1 Why chat is worth building
   1.2 Common use cases
   1.3 Implementation strategy
   1.4 When this is worth building

2. User reads Build Decisions
   2.1 What this guide is
   2.2 Implementation decisions table

3. User selects starting point
   DECISION D1: Has existing Next.js application?

   D1.YES → GO TO 4 (Tutorial 2: Existing App)
   D1.NO  → GO TO 5 (Tutorial 1: From Scratch)

4. TUTORIAL 2: Adding Chat to Existing Next.js Application
   4.1 Read prerequisites [INCLUDE: prerequisites.mdx]
   4.2 Read Architecture & Scope
   4.3 Backend Setup
       DECISION D2: Already has MooseStack project?

       D2.YES → 4.3.1 Add MCP to existing MooseStack
                4.3.1.1 Install MCP dependencies
                4.3.1.2 Add MCP server file
                4.3.1.3 Export from index.ts
                4.3.1.4 Generate API key
                → GO TO 4.4

       D2.NO  → 4.3.2 Add MooseStack service to monorepo
                4.3.2.1 Pull moosestack-service from template
                4.3.2.2 Add to workspace
                4.3.2.3 Install dependencies
                4.3.2.4 Configure environment variables
                4.3.2.5 Add dev scripts
                → GO TO 4.4

   4.4 Frontend Setup
       4.4.1 Install dependencies
       4.4.2 Configure environment variables
       4.4.3 Add chat API route
       4.4.4 Add agent config
       4.4.5 Add MCP client
       4.4.6 (Optional) Add status endpoint
       4.4.7 Add UI components

   4.5 Integration & Testing
       4.5.1 Start both services
       4.5.2 Verify MCP server
       4.5.3 Test the chat

   4.6 Deploy [INCLUDE: deploy-to-fiveonefour-and-vercel.mdx]
   4.7 Troubleshoot [INCLUDE: troubleshooting.mdx]
   → END

5. TUTORIAL 1: From Parquet in S3 to Chat Application
   5.1 Read prerequisites [INCLUDE: prerequisites.mdx]

   5.2 Read Architecture & Scope

   5.3 Setup
       5.3.1 Install Moose CLI
       5.3.2 Initialize project from template
       5.3.3 Create and configure .env files

   5.4 Local Development
       5.4.1 Verify Docker is running
       5.4.2 Run the stack

   5.5 (Optional) MCP Setup [INCLUDE: optional-mcp-setup.mdx]

   5.6 Model your data
       DECISION D3: Using sample dataset?

       D3.YES → Use Amazon Customer Reviews dataset
       D3.NO  → Use own S3 data

       [BOTH PATHS CONTINUE:]
       5.6.1 Copy data from S3
             IF D3.YES: [TOGGLE: Amazon dataset copy commands]
       5.6.2 Add context for data modeling
       5.6.3 Model data with AI
             IF D3.YES: [TOGGLE: Amazon dataset model example]
       5.6.4 Verify tables created

   5.7 Bulk add data locally
       IF D3.YES: [TOGGLE: Amazon dataset bulk load commands]

   5.8 Test and extend frontend
       5.8.1 Chat with your data
       5.8.2 Create custom API endpoints and frontend

   5.9 Deploy [INCLUDE: deploy-to-fiveonefour-and-vercel.mdx]

   5.10 Hydrate production deployment
        IF D3.YES: [TOGGLE: Amazon dataset production hydration]

   5.11 Troubleshoot [INCLUDE: troubleshooting.mdx]
   → END

6. (Optional) Read Appendix: Data context as code

**POSTCONDITIONS:**
- User has working chat-over-data application
- Chat can query ClickHouse via MCP tools
- Application deployed to Fiveonefour + Vercel (if chosen)

---

## Decision Tree Summary

```
D1: Has existing Next.js app?
├─ YES → D2: Already has MooseStack?
│        ├─ YES → Add MCP only path
│        └─ NO  → Add MooseStack + MCP path
│
└─ NO  → D3: Using sample dataset?
         ├─ YES → Show Amazon dataset toggles (×4)
         └─ NO  → Hide Amazon dataset toggles
```

---

## Extension Points (Toggles)

| ID | Name | Trigger | Step |
|----|------|---------|------|
| E1 | Amazon dataset - Copy from S3 | D3.YES | 5.6.1 |
| E2 | Amazon dataset - Model example | D3.YES | 5.6.3 |
| E3 | Amazon dataset - Bulk load | D3.YES | 5.7 |
| E4 | Amazon dataset - Production hydration | D3.YES | 5.10 |
| E5 | Existing MooseStack - Add MCP | D2.YES | 4.3 |

---

## Shared Content (Includes)

| ID | File | Used In |
|----|------|---------|
| I1 | prerequisites.mdx | 5.1, 4.1 |
| I2 | optional-mcp-setup.mdx | 5.5 |
| I3 | deploy-to-fiveonefour-and-vercel.mdx | 5.9, 4.6 |
| I4 | troubleshooting.mdx | 5.11, 4.7 |

---

## Proposed Interactive Components Mapping

To convert current structure to interactive components:

| Current | Proposed Component | ID |
|---------|-------------------|-----|
| D1 (two tutorials) | `SelectField` | `starting-point` |
| D2 (has MooseStack) | `SelectField` or nested `ConditionalContent` | `has-moosestack` |
| D3 (sample dataset) | `CheckboxGroup` | `use-sample-dataset` |
| E1-E4 (Amazon toggles) | `ConditionalContent` with `match="includes"` | tied to D3 |
| E5 (Add MCP toggle) | `ConditionalContent` | tied to D2 |

### Potential unified structure:

```
CustomizePanel
├─ SelectField id="starting-point"
│  ├─ "scratch" - New project from template
│  ├─ "existing-nextjs" - Adding to existing Next.js
│  └─ "existing-moose" - Already have MooseStack (collapses D1+D2)
│
└─ CheckboxGroup id="options"
   └─ "sample-dataset" - Use Amazon reviews sample
```

This would collapse D1 and D2 into a single 3-way choice, simplifying the tree.
