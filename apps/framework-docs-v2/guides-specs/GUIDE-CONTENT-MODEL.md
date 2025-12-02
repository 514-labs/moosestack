# Guide Content Model - API Specification

**Status**: API defined, implementation pending

This document defines the developer-facing API for technology-variant guides.

**Capabilities:**
- Render guides with technology-variant content
- Export entire guide to Linear as a project with issues
- Export individual steps as agent prompts for coding assistants

---

## Developer Experience

Authors write MDX naturally, defining dimensions in frontmatter and using conditional components inline:

## Quick Start

```mdx
---
title: Set Up Your Database
techSelector:
  - dimension: oltp
    label: Database
    options:
      - { value: postgresql, label: PostgreSQL, default: true }
      - { value: mysql, label: MySQL }
---

import { TechContextProvider, TechSelector, When, Steps, Step } from "@514labs/design-system-components/guides";

<TechContextProvider frontmatter={frontmatter}>

<TechSelector />

<Steps>

<Step title="Enable Replication">

<When dimension="oltp" equals="postgresql">

Run this SQL command:

```sql
SHOW wal_level;
```

</When>

<When dimension="oltp" equals="mysql">

Check your MySQL config:

```sql
SHOW VARIABLES LIKE 'log_bin';
```

</When>

</Step>

<Step title="Start the Pipeline">

Run the dev server:

```bash
moose dev
```

</Step>

</Steps>

</TechContextProvider>
```

Step numbers are assigned automatically based on render order. Conditional steps are numbered correctly—if a step is hidden, subsequent steps renumber.

---

## Frontmatter Config

Define your dimensions in YAML frontmatter:

```yaml
---
title: My Guide
description: Guide description
techSelector:
  - dimension: oltp
    label: Source Database
    options:
      - { value: postgresql, label: PostgreSQL, default: true }
      - { value: mysql, label: MySQL }
  - dimension: language
    label: Language
    options:
      - { value: typescript, label: TypeScript, default: true }
      - { value: python, label: Python }
---
```

Dimension names are **open-ended strings**. Use any name relevant to your guide:

| Common Dimensions | Custom Examples |
|-------------------|-----------------|
| `language`, `oltp`, `olap`, `streaming`, `orm`, `deployment`, `cloud`, `packageManager` | `authProvider`, `paymentGateway`, `ciPlatform`, `containerRuntime` |

---

## Conditional Components

### `<When>` - Show content for a specific value

```mdx
<When dimension="oltp" equals="postgresql">

PostgreSQL uses WAL (Write-Ahead Logging) for replication.

```sql
ALTER SYSTEM SET wal_level = logical;
```

</When>
```

### `<When>` with multiple values

```mdx
<When dimension="language" oneOf={["typescript", "javascript"]}>

Install the npm package:

```bash
npm install @514labs/moose-lib
```

</When>
```

### `<NotWhen>` - Show content when condition is NOT met

```mdx
<NotWhen dimension="orm" equals="none">

Since you're using an ORM, you can reuse your existing models.

</NotWhen>
```

### `<TechSwitch>` / `<TechCase>` - Mutually exclusive content

When every option has distinct content:

```mdx
<TechSwitch dimension="oltp">
  <TechCase value="postgresql">

## PostgreSQL Setup

Enable logical replication in `postgresql.conf`:

```properties
wal_level = logical
```

  </TechCase>
  <TechCase value="mysql">

## MySQL Setup

Enable binary logging in `my.cnf`:

```properties
log_bin = mysql-bin
binlog_format = ROW
```

  </TechCase>
</TechSwitch>
```

### `<TechRef>` - Inline dynamic text

Insert the user's current selection:

```mdx
Now that you've configured your <TechRef dimension="oltp" /> database, 
you can start streaming changes to ClickHouse.
```

Renders as: "Now that you've configured your **PostgreSQL** database..."

Custom labels:

```mdx
<TechRef 
  dimension="oltp" 
  labels={{ postgresql: "Postgres", mysql: "MySQL Server" }} 
/>
```

### `<Conditional>` - Complex predicates

For AND/OR/NOT logic:

```mdx
<Conditional when={{ 
  and: [
    { dimension: "language", equals: "typescript" },
    { dimension: "orm", equals: "drizzle" }
  ]
}}>

Drizzle with TypeScript setup...

</Conditional>

<Conditional when={{
  or: [
    { dimension: "orm", equals: "drizzle" },
    { dimension: "orm", equals: "prisma" }
  ]
}}>

ORM-specific instructions...

</Conditional>

<Conditional 
  when={{ dimension: "deployment", equals: "cloud" }}
  fallback={<p>This section only applies to cloud deployments.</p>}
>

Cloud deployment instructions...

</Conditional>
```

---

## Complete Example

```mdx
---
title: Stream Data from Your Database with Debezium
description: Mirror your database to ClickHouse in real-time.
techSelector:
  - dimension: oltp
    label: Source Database
    options:
      - { value: postgresql, label: PostgreSQL, default: true }
      - { value: mysql, label: MySQL }
  - dimension: orm
    label: Schema Source
    options:
      - { value: none, label: Generate from DB, default: true }
      - { value: drizzle, label: Drizzle ORM }
      - { value: prisma, label: Prisma }
---

import { 
  TechContextProvider, 
  TechSelector, 
  Steps,
  Step,
  When, 
  NotWhen,
  TechSwitch, 
  TechCase,
  TechRef 
} from "@514labs/design-system-components/guides";

<TechContextProvider frontmatter={frontmatter} storageKey="cdc-guide">

<TechSelector className="my-6 p-4 bg-muted/50 rounded-lg" />

# Stream Data from Your Database with Debezium

This guide shows you how to stream changes from your <TechRef dimension="oltp" /> 
database to ClickHouse in real-time.

<Steps>

<Step title="Configure Your Environment">

Copy the environment file and set your database credentials:

```bash
cp .env.example .env.dev
```

<TechSwitch dimension="oltp">
  <TechCase value="postgresql">

```properties
DB_HOST=your_postgres_host
DB_PORT=5432
CDC_TOPIC_PREFIX=pg-cdc
```

  </TechCase>
  <TechCase value="mysql">

```properties
DB_HOST=your_mysql_host
DB_PORT=3306
CDC_TOPIC_PREFIX=mysql-cdc
```

  </TechCase>
</TechSwitch>

</Step>

<Step title="Prepare Your Database">

<When dimension="oltp" equals="postgresql">

Debezium needs PostgreSQL's logical replication. Check it's enabled:

```sql
SHOW wal_level;
```

It must be `logical`. If not, update `postgresql.conf` and restart.

Create a replication user:

```sql
CREATE USER cdc_user WITH PASSWORD 'secure_password';
ALTER USER cdc_user WITH REPLICATION;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO cdc_user;
```

</When>

<When dimension="oltp" equals="mysql">

Debezium needs MySQL's binary logging. Check it's enabled:

```sql
SHOW VARIABLES LIKE 'log_bin';
```

It must be `ON`. If not, update `my.cnf`:

```properties
[mysqld]
server-id=1
log_bin=mysql-bin
binlog_format=ROW
```

Create a CDC user:

```sql
CREATE USER 'cdc_user'@'%' IDENTIFIED BY 'secure_password';
GRANT SELECT, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'cdc_user'@'%';
```

</When>

</Step>

<Step title="Define Your Schema">

<NotWhen dimension="orm" equals="none">

Since you're using <TechRef dimension="orm" />, reuse your existing models:

<TechSwitch dimension="orm">
  <TechCase value="drizzle">

```typescript
import { customerAddresses } from "./schema";

export type CustomerAddress = typeof customerAddresses.$inferSelect;
```

  </TechCase>
  <TechCase value="prisma">

```typescript
import type { CustomerAddress } from "@prisma/client";

export type { CustomerAddress };
```

  </TechCase>
</TechSwitch>

</NotWhen>

<When dimension="orm" equals="none">

Generate TypeScript types from your database:

<TechSwitch dimension="oltp">
  <TechCase value="postgresql">

```bash
npx kanel --connectionString $DATABASE_URL --output ./generated
```

  </TechCase>
  <TechCase value="mysql">

```bash
npx mysql-schema-ts mysql://user:pass@localhost/db --output ./generated
```

  </TechCase>
</TechSwitch>

</When>

</Step>

</Steps>

## Verification

Any change in your <TechRef dimension="oltp" /> table will now appear in ClickHouse:

```bash
moose query "SELECT * FROM customer_addresses"
```

</TechContextProvider>
```

---

## Export Capabilities

### Step Metadata for Export

Each step can include metadata for Linear and agent exports:

```tsx
<Step
  id="configure-db"
  title="Configure Database Connection"
  task={{
    estimate: "m",
    labels: ["backend", "setup"],
    acceptanceCriteria: [
      "DATABASE_URL is set in .env",
      "Connection test passes",
      "Migrations run without errors"
    ],
    dependsOn: ["install-deps"]
  }}
  agent={{
    goal: "Set up PostgreSQL connection with Drizzle ORM",
    files: ["src/db/index.ts", "src/db/schema.ts", ".env"],
    commands: ["pnpm db:generate", "pnpm db:migrate"],
    expectedOutcome: "Database tables are created and queryable",
    avoid: ["Don't commit .env file", "Don't use raw SQL"]
  }}
>

...step content...

</Step>
```

### Export to Linear

Export the entire guide as a Linear project:

```tsx
// In guide frontmatter
---
project:
  name: "CDC Pipeline Setup"
  team: "Platform"
  priority: 2
  labels: ["infrastructure", "q1-2024"]
---
```

UI provides:
- "Export to Linear" button on guide page
- Creates project with issues for each step
- Acceptance criteria become issue checklists
- Dependencies map to issue links

### Export as Agent Prompt

Each step has a "Copy as Prompt" button that generates:

```markdown
## Goal

Set up PostgreSQL connection with Drizzle ORM

## Files

- `src/db/index.ts`
- `src/db/schema.ts`
- `.env`

## Instructions

[Step content rendered as markdown]

## Commands

```bash
pnpm db:generate
pnpm db:migrate
```

## Expected Outcome

Database tables are created and queryable

## Avoid

- Don't commit .env file
- Don't use raw SQL
```

### Programmatic Export

```tsx
import { 
  stepToLinearIssue, 
  stepToAgentPrompt,
  stepsToLinearProject,
  copyStepAsAgentPrompt 
} from "@514labs/design-system-components/guides";

// Single step → Linear issue
const issue = stepToLinearIssue(stepData);

// Single step → Agent prompt
const prompt = stepToAgentPrompt(stepData);

// All steps → Linear project
const project = stepsToLinearProject(projectMeta, allSteps);

// Copy to clipboard
await copyStepAsAgentPrompt(stepData);
```

---

## Best Practices

**Keep variations minimal.** Most content should be unconditional. Only wrap the parts that genuinely differ.

**Use `<TechRef>` for inline names.** Instead of `<When equals="postgresql">PostgreSQL</When><When equals="mysql">MySQL</When>`, just use `<TechRef dimension="oltp" />`.

**Test all combinations.** Before publishing, cycle through each option and verify the content makes sense.

**Nest markdown naturally.** The components work with standard markdown—code blocks, headers, lists all work inside conditionals.

---

## Implementation Checklist

### TechContextProvider
- [ ] Parse config from `frontmatter.techSelector` or `config` prop
- [ ] Initialize state with defaults from config
- [ ] Persist to localStorage when `storageKey` provided
- [ ] Hydrate from localStorage on mount (avoid SSR mismatch)
- [ ] Expose context via React Context

### TechSelector
- [ ] Render dropdown for each dimension
- [ ] Update context on selection change
- [ ] Style: filter bar aesthetic, responsive

### Conditional / When / NotWhen
- [ ] Evaluate predicates (`equals`, `oneOf`, `and`, `or`, `not`)
- [ ] Show/hide children based on evaluation
- [ ] Support `fallback` prop

### TechSwitch / TechCase
- [ ] Match current dimension value to case
- [ ] Render matching case's children
- [ ] Support fallback when no match

### TechRef
- [ ] Get current value for dimension
- [ ] Apply custom labels if provided
- [ ] Render inline (no wrapper element)

### Steps / Step
- [ ] Track rendered steps in order
- [ ] Assign sequential numbers (skip hidden conditional steps)
- [ ] Style: number badge, title, content layout
- [ ] Handle dynamic re-numbering when conditionals change
- [ ] Render export buttons (Linear, Agent Prompt)
- [ ] Extract step content as markdown for export

### Export - Linear
- [ ] "Export to Linear" button on guide page
- [ ] Convert steps to Linear project JSON
- [ ] Map estimates to story points
- [ ] Map acceptance criteria to checklist markdown
- [ ] Map dependencies to issue links
- [ ] Copy single issue markdown to clipboard

### Export - Agent Prompt
- [ ] "Copy as Prompt" button on each step
- [ ] Generate structured prompt from step metadata
- [ ] Include files, commands, expected outcome
- [ ] Resolve conditional content based on current tech context
- [ ] Copy to clipboard with success feedback
