# PR 3934 Commit Sequence Analysis

Context: local branch `lucio/fix-dockerless` is branched from the PR branch for
`514-labs/moosestack#3934`. This note documents what the commit sequence was
trying to do before we start reverting test-harness changes and re-running the
full local suite.

## High-level conclusion

The PR has two distinct phases:

1. Infrastructure enablement for dockerless E2E:
   native ClickHouse/devkafka/devredis support, port isolation, and replacing
   Docker-only assertions with dockerless equivalents.
2. Test-template mutation to make the heavy `tests` template pass by reducing
   load instead of fixing the underlying runtime bottleneck.

The first phase is likely still desirable. The second phase is the functional
backslide we want to remove before doing local validation.

## Phase 1: dockerless/native infra enablement

These commits are the core dockerless work and should be treated separately from
later test mutations:

- `70b3e9961` `feat(devkafka): implement ListGroups and DescribeGroups Kafka APIs`
- `a284ea3a9` `feat: switch all E2E tests to dockerless mode with consumer group polling`
- `1030312eb` `fix: use per-topic consumer group IDs for clickhouse_sync and skip workflow trigger in dockerless tests`
- `671b5c0f5` `fix: add writable access storage to native ClickHouse config for RLS support`
- `f6ac52bb4` `fix(native-infra): restore ClickHouse auth by splitting users.xml`
- `bd815a058` `fix(native-infra): move profiles/quotas to config.xml for ClickHouse startup`
- `71c914371` `fix(native-infra): use users_config + local_directory for ClickHouse`
- `34772be06` `fix(native-infra): add custom_settings_prefixes for RLS query settings`
- `f7f8ec217` `fix(e2e): wait for keeper ports to be released between test suites`
- `bbb0b7358` `fix(e2e): prevent docker compose down hang in dockerless mode`
- `8e680b0f6` `ci: add timeout-minutes to Tests Template jobs, remove Docker cleanup`
- `3deff864f` `feat(e2e): port isolation for parallel test execution`
- `9db2ca306` `fix(clickhouse): add keeper port fields to remote ClickHouseConfig initializer`
- `435582bff` `fix(e2e): replace Docker-specific assertions with dockerless equivalents`
- `1de79cf83` `fix(e2e): correct Kafka engine table test for dockerless mode`

Additional earlier support commits on the branch also belong to the
infrastructure bring-up path:

- `926a3eec0` TypeScript compilation fix
- `a7e95de30` seed failure diagnostics
- `e2fc68fe2` remote() seed-filter fix

## Phase 2: stabilization attempts inside `templates.test.ts`

Starting on `2026-04-13`, the work shifts from infrastructure to trying to
stabilize the heavy `tests` template entirely inside the E2E harness:

- `7d6b296e6` use `ingestAndVerify()` for retry-send/retry-verify ingestion
- `e2d362599` restart dev server before ingestion in tests variant
- `f48f7a7fc` increase consumer-group polling patience
- `ce7a2bab2` require stable group-count confirmations before ready
- `344ca2066` add pipeline probe before batch ingestion
- `f8b94cada` remove restart, keep probe-only strategy
- `aec9460ce` split TS/Python restart strategy and wait for devkafka port
- `8748bd6e6` reorder tests to run ingestion before file-modification tests
- `5a3154c98` add another pipeline probe pass
- `acb152105` increase stabilization timeouts to 90s and widen retry windows

These commits all share the same assumption: the failure is due to slow or
unstable startup timing after hot reloads, and the right fix is more retries,
more waiting, restarts, or changed test order.

## Phase 3: diagnosis shift from timing to load shedding

The final three commits change the diagnosis. Instead of treating the issue as
timing, they start modifying the temporary test project itself:

- `1bf13048e` sanitize Kafka engine and S3Queue tables for dockerless mode
- `08cbfdf35` remove Kafka/S3Queue/S3 imports entirely
- `03e3496d9` aggressively reduce consumer groups in dockerless mode for tests template

This is where the PR stops trying to make the real `tests` template pass
unchanged and instead makes a smaller, different template run under devkafka.

## What the final autofix was trying to do

The final strategy in `03e3496d9` was:

- mutate the generated temp project before starting `moose dev --dockerless`
- remove imports that create engine tables or background polling
- disable `stream` and `dead_letter_queue` on most non-essential pipelines
- truncate transforms to keep only the Foo/Bar path and minimal consumers
- remove some consumer registrations
- skip feature tests whose pipelines were disabled

This reduces devkafka load enough for the remaining ingestion path to pass, but
it is no longer validating the actual `tests` template behavior.

## Working hypothesis

The root problem is not primarily test ordering or stabilization timing.
The heavy `tests` template creates substantially more streaming load and
consumer groups than the default template, and current dockerless runtime
capacity appears insufficient for the unmodified template.

The final Claude changes are therefore best interpreted as load shedding rather
than a real fix.

## Revert boundary for local validation

Before running the full local suite, we should remove the functional test
mutations and get back to the unmodified template behavior.

Initial target for rollback:

- definitely revert:
  `1bf13048e`, `08cbfdf35`, `03e3496d9`
- likely also revert the stabilization-only harness stack:
  `7d6b296e6`, `e2d362599`, `f48f7a7fc`, `ce7a2bab2`, `344ca2066`,
  `f8b94cada`, `aec9460ce`, `8748bd6e6`, `5a3154c98`, `acb152105`

That should leave the dockerless infrastructure work intact while removing the
changes that altered test behavior or masked the real capacity issue.
