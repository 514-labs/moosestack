# Operator metrics — connection-churn observability (Phase 0)

These metrics are exposed by the management server on `GET /metrics` in
OpenMetrics text format. They were introduced by the Phase 0 observability
work of the Redpanda connection-management plan
(`.cursor/plans/redpanda-connection-management/connection-churn/plan_connection-churn.md`)
and are the measurement baseline for every subsequent fix phase.

## `moose_kafka_client_gauge{purpose}`

- **Type**: Gauge
- **Description**: Number of live Kafka client handles held by this
  process, broken down by the role of the client. Incremented when a
  handle is constructed, decremented when the last reference is dropped.
- **Labels**:
  - `purpose` — one of the role constants defined in
    `apps/framework-cli/src/infrastructure/stream/kafka/client.rs`:
    `ingest_producer`, `idempotent_producer`, `sync_producer`,
    `sync_consumer`, `peek_consumer`, `mcp_sample_consumer`,
    `health_probe`, `fetch_topics_consumer`, `fetch_topics_admin`,
    `check_topic_size_consumer`, `admin_add_partitions`,
    `admin_update_topic_config`, `admin_create_topics`,
    `admin_delete_topics`, `admin_describe_topic_config`,
    `function_worker_estimated` (see note below).
- **Expected range (per pod)**: in the ~20–30 region in steady state on
  a main-branch deployment with 6 function processes; the exact
  per-purpose breakdown is tracked on the connection-churn dashboard.
  A sustained value of zero for any `purpose` usually indicates the
  code path is inactive rather than a broken metric.
- **Notes**: `function_worker_estimated` is a coarse proxy emitted from
  the Rust supervisor (`functions_registry.rs`) — one tick per parallel
  worker — because TypeScript and Python workers don't use `rdkafka` and
  therefore can't be instrumented the same way.

## `moose_function_worker_restarts_total{reason}`

- **Type**: Counter (exposed as `..._total` by the OpenMetrics encoder).
- **Description**: Cumulative count of streaming-function worker
  restarts since process start, bucketed by exit classification.
- **Labels**:
  - `reason` — Rust-supervised children emit one of
    `rust_child_exit_ok`, `rust_child_exit_err_code`,
    `rust_child_exit_signal`, `rust_child_wait_err`. TypeScript clusters
    emit `ts_worker_exit_code_0`, `ts_worker_exit_code_nonzero`,
    `ts_worker_killed_by_signal_<SIGNAL>`, or `ts_worker_killed_other`.
    Python runners emit `py_worker_exit_code_0`,
    `py_worker_exit_code_nonzero`, or `py_worker_killed_by_<SIGNAL>`.
- **Expected range**: `rate(...[5m])` should be 0 in steady state. Any
  sustained non-zero rate indicates a misbehaving function and is worth
  paging on.

## `moose_function_process_diff_updated_total{reason}`

- **Type**: Counter (exposed as `..._total`).
- **Description**: Cumulative count of iterations through
  `InfrastructureMap::diff_function_processes` that decided to emit a
  `ProcessChange::Updated`, labelled by the root cause of the decision.
- **Labels**:
  - `reason`:
    - `forced_always` — pre-Phase-1 behaviour: every existing function
      process is treated as changed even when its fields are identical.
      This is the counter Phase 1 will drive to zero.
    - `no_change` — fields match exactly; still emits an `Updated` in
      Phase 0 (behaviour is unchanged; Phase 1 will make this a no-op).
    - Phase 1 introduces finer-grained reasons
      (`executable_changed`, `version_changed`, etc.); they'll replace
      `forced_always` in the dominant series.
- **Expected range**: Phase 0 baseline is ~0.83/s/pod across the fleet
  (see research §3.1). Post-Phase-1, the `forced_always` series must
  drop to zero; a non-zero rate after rollout is the regression signal.

## Kill-switch — `MOOSE_KAFKA_CLIENT_METRICS_DISABLED`

Setting this env var to a non-empty value disables `kafka_client_gauge`
instrumentation for the process. Used to rule out metric-tracking as a
CPU/memory regression source during rollout. The
`function_worker_restarts_total` and `function_process_diff_updated_total`
counters are **not** gated by this switch — they're cheap and do not
touch the hot Kafka client path.

## Endpoints used by language workers

Worker processes outside the Rust supervisor (TypeScript `cluster`
workers, Python streaming runners) don't have direct access to the Rust
metrics registry. They POST JSON event bodies to
`http://127.0.0.1:${MOOSE_MANAGEMENT_PORT}/metrics-logs`, where the
`metrics_log_route` handler forwards them to the shared registry. Only
`StreamingFunctionEvent` and `FunctionWorkerRestart` payloads are
currently accepted; see `apps/framework-cli/src/cli/local_webserver.rs`
for the exact allow-list.
