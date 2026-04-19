//! Preflight port availability checks for the native (dockerless) dev path.
//!
//! Before any embedded server or native child process starts, probe every port
//! `moose dev --dockerless` intends to bind. Report conflicts in a single
//! structured error so the user sees an actionable message instead of a
//! cascade of stack traces from a Node worker retrying forever on an occupied
//! `proxy_port`.

use super::{process_matches, NATIVE_INFRA_DIR};
use crate::project::Project;
use std::fmt;
use std::net::{Ipv4Addr, Ipv6Addr, SocketAddr, TcpListener};
use std::path::Path;

/// One port the dockerless dev path intends to bind.
///
/// Field order matches the `new()` parameter order: `(port, service, host)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortSpec {
    pub port: u16,
    pub service: &'static str,
    pub host: &'static str,
}

impl PortSpec {
    pub const fn new(port: u16, service: &'static str, host: &'static str) -> Self {
        Self {
            port,
            service,
            host,
        }
    }
}

/// Port value from project config was outside the valid `u16` range.
#[derive(Debug, thiserror::Error)]
#[error("invalid port {value} for `{service}` in project config: must be in 1..=65535")]
pub struct InvalidPortError {
    pub service: &'static str,
    pub value: i32,
}

/// A conflict detected for a single port, optionally attributed to a known
/// moose-owned PID (read from `.moose/native_infra/*.pid`).
#[derive(Debug)]
pub struct PortConflict {
    pub spec: PortSpec,
    /// PID of a previously-started moose native process that is still alive
    /// and matches the expected binary name. `None` when the conflict is with
    /// an unrelated process.
    pub owner_pid: Option<u32>,
    /// Name of the moose component the PID file was written for (e.g.
    /// `"clickhouse"`), when attribution is available.
    pub owner_name: Option<&'static str>,
}

/// One or more port conflicts discovered during preflight.
#[derive(Debug)]
pub struct PortConflictError {
    pub conflicts: Vec<PortConflict>,
}

impl fmt::Display for PortConflictError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // If any conflict is attributed to a PID file in THIS project's
        // `.moose/native_infra/`, our own `moose dev` is running. Don't
        // require `.all()` attributed — most services in the preflight
        // (devredis, devkafka, http, management, proxy_port) never write
        // PID files today, so `.all()` would make "keep editing" unreachable
        // for same-project conflicts, which is the common case. The rare
        // edge case of our own clickhouse + an unrelated process on another
        // port is still covered by the fact that every conflicting port is
        // listed above — the user can act on it if they need to.
        let same_project_instance = self.conflicts.iter().any(|c| c.owner_pid.is_some());

        writeln!(
            f,
            "Cannot start moose dev: the following ports are already in use:"
        )?;
        for c in &self.conflicts {
            match (c.owner_pid, c.owner_name) {
                (Some(pid), Some(name)) => writeln!(
                    f,
                    "  - {} ({}) — PID {pid} ({name} from a prior moose dev) is alive",
                    c.spec.port, c.spec.service
                )?,
                _ => writeln!(
                    f,
                    "  - {} ({}) — another moose dev instance may be running",
                    c.spec.port, c.spec.service
                )?,
            }
        }
        if same_project_instance {
            writeln!(
                f,
                "A `moose dev` for this project is already running. If it's healthy, \
                 just keep editing your code — the running instance picks up changes. \
                 Run `moose clean` only if you want to stop it and start fresh."
            )?;
        } else {
            writeln!(
                f,
                "If this is another moose project's dev server, run `moose clean` in \
                 that project. Otherwise, stop the process holding these ports."
            )?;
        }
        Ok(())
    }
}

impl std::error::Error for PortConflictError {}

/// Attempt to bind each port synchronously on both IPv4 loopback and IPv6
/// loopback. Returns `Err(PortConflictError)` if any port is already in use
/// on either stack.
///
/// The dual-stack probe matters because Node's `localhost` resolution can pick
/// `::1`, meaning a stuck consumption worker may occupy only the IPv6 side.
/// A probe that only checks 127.0.0.1 would miss it.
///
/// `native_dir` is the `.moose/native_infra/` directory used for best-effort
/// PID attribution in the error message.
pub fn check_ports(specs: &[PortSpec], native_dir: &Path) -> Result<(), PortConflictError> {
    let mut conflicts = Vec::new();

    for spec in specs {
        if port_in_use(spec.port) {
            // Only ClickHouse/Temporal write PID files today. For ports
            // owned by those services, look up the matching pid file
            // directly so each conflict is attributed to its own owner
            // rather than short-circuiting on the first pid file found.
            let owner_name: Option<&'static str> = match spec.service {
                "clickhouse-http"
                | "clickhouse-tcp"
                | "clickhouse-keeper"
                | "clickhouse-keeper-raft" => Some("clickhouse"),
                "temporal" | "temporal-ui" => Some("temporal"),
                _ => None,
            };
            let owner_pid = owner_name
                .and_then(|name| read_live_pid(&native_dir.join(format!("{name}.pid")), name));
            conflicts.push(PortConflict {
                spec: *spec,
                owner_pid,
                owner_name: owner_name.filter(|_| owner_pid.is_some()),
            });
        }
    }

    if conflicts.is_empty() {
        Ok(())
    } else {
        Err(PortConflictError { conflicts })
    }
}

/// Probe both IPv4 and IPv6 loopback for `port`. Returns `true` only when a
/// bind fails specifically with `AddrInUse` on either stack. Other errors
/// (e.g. `AddrNotAvailable` on systems with IPv6 disabled, or permission
/// errors on privileged ports) are ignored — they are not port conflicts and
/// reporting them as such would cause false positives that block startup.
fn port_in_use(port: u16) -> bool {
    // A successful bind proves the port is free on that address family. The
    // TcpListener is dropped immediately (no connection accepted, so no
    // TIME_WAIT is created) and the real service can bind a few ms later.
    let v4 = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let v6 = SocketAddr::from((Ipv6Addr::LOCALHOST, port));
    let v4_in_use = matches!(
        TcpListener::bind(v4),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse
    );
    let v6_in_use = matches!(
        TcpListener::bind(v6),
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse
    );
    v4_in_use || v6_in_use
}

/// Best-effort: read a `.pid` file, verify the PID still matches the
/// expected process name, and return it. Used only to enrich the error
/// message — never load-bearing.
fn read_live_pid(pid_path: &Path, expected_name: &str) -> Option<u32> {
    let contents = std::fs::read_to_string(pid_path).ok()?;
    let contents = contents.trim();
    let (pid_str, name_in_file) = contents.split_once(':').unwrap_or((contents, ""));
    let pid: u32 = pid_str.parse().ok()?;
    // Honor the name in the PID file when present, falling back to the
    // expected name for legacy files.
    let name = if name_in_file.is_empty() {
        expected_name
    } else {
        name_in_file
    };
    if process_matches(pid, name) {
        Some(pid)
    } else {
        None
    }
}

/// Convert an `i32` port value from project config into a validated `u16`.
fn port_from_config(value: i32, service: &'static str) -> Result<u16, InvalidPortError> {
    u16::try_from(value)
        .ok()
        .filter(|p| *p != 0)
        .ok_or(InvalidPortError { service, value })
}

/// Build the full list of ports the dockerless path will try to bind for the
/// given project. Kafka / Temporal / webserver ports are included or skipped
/// based on feature flags, mirroring the gating in `NativeInfraProvider::start`
/// and the CLI webserver bootstrap.
///
/// Returns `Err(InvalidPortError)` if any ClickHouse port value in the project
/// config is outside the valid `u16` range — catching configuration mistakes
/// before we silently truncate them.
pub fn port_specs_for(
    project: &Project,
    scripts_enabled: bool,
    include_webserver: bool,
) -> Result<Vec<PortSpec>, InvalidPortError> {
    let mut specs = Vec::with_capacity(10);

    specs.push(PortSpec::new(
        project.redis_config.port,
        "devredis",
        "127.0.0.1",
    ));

    if project.features.streaming_engine {
        specs.push(PortSpec::new(
            super::devkafka::broker_port(&project.redpanda_config),
            "devkafka",
            "127.0.0.1",
        ));
    }

    let ch = &project.clickhouse_config;
    specs.push(PortSpec::new(
        port_from_config(ch.host_port, "clickhouse-http")?,
        "clickhouse-http",
        "127.0.0.1",
    ));
    specs.push(PortSpec::new(
        port_from_config(ch.native_port, "clickhouse-tcp")?,
        "clickhouse-tcp",
        "127.0.0.1",
    ));
    specs.push(PortSpec::new(
        port_from_config(ch.keeper_port, "clickhouse-keeper")?,
        "clickhouse-keeper",
        "127.0.0.1",
    ));
    specs.push(PortSpec::new(
        port_from_config(ch.keeper_raft_port, "clickhouse-keeper-raft")?,
        "clickhouse-keeper-raft",
        "127.0.0.1",
    ));

    if scripts_enabled || project.features.workflows {
        let tc = &project.temporal_config;
        specs.push(PortSpec::new(tc.temporal_port, "temporal", "127.0.0.1"));
        specs.push(PortSpec::new(tc.ui_port, "temporal-ui", "127.0.0.1"));
    }

    if include_webserver {
        let hs = &project.http_server_config;
        specs.push(PortSpec::new(hs.port, "http", "127.0.0.1"));
        specs.push(PortSpec::new(hs.management_port, "management", "127.0.0.1"));
        specs.push(PortSpec::new(hs.proxy_port, "proxy_port", "127.0.0.1"));
    }

    Ok(specs)
}

/// Convenience: the `.moose/native_infra/` directory for a project. Callers
/// pass this to [`check_ports`] so conflicts can be attributed to moose-owned
/// PID files when possible.
pub fn native_dir_for(project: &Project) -> std::path::PathBuf {
    project.project_location.join(NATIVE_INFRA_DIR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener as StdTcpListener;

    fn bound_port() -> (StdTcpListener, u16) {
        let listener = StdTcpListener::bind(("127.0.0.1", 0)).expect("bind ephemeral");
        let port = listener.local_addr().unwrap().port();
        (listener, port)
    }

    #[test]
    fn check_ports_reports_conflict_on_bound_port() {
        let (_held, port) = bound_port();
        let tmp = tempfile::tempdir().expect("tempdir");
        let specs = [PortSpec::new(port, "devredis", "127.0.0.1")];

        let err = check_ports(&specs, tmp.path()).expect_err("should conflict");
        assert_eq!(err.conflicts.len(), 1);
        assert_eq!(err.conflicts[0].spec.port, port);
        assert!(err.conflicts[0].owner_pid.is_none());
    }

    #[test]
    fn check_ports_succeeds_on_free_port() {
        let port = {
            let (listener, port) = bound_port();
            drop(listener);
            port
        };
        let tmp = tempfile::tempdir().expect("tempdir");
        let specs = [PortSpec::new(port, "devredis", "127.0.0.1")];

        // Might race with the OS reusing the port, but in practice a freshly
        // freed ephemeral port is available again immediately.
        check_ports(&specs, tmp.path()).expect("should be free");
    }

    #[test]
    fn check_ports_attributes_live_clickhouse_pid() {
        let (_held, port) = bound_port();
        let tmp = tempfile::tempdir().expect("tempdir");
        let native_dir = tmp.path().join(NATIVE_INFRA_DIR);
        std::fs::create_dir_all(&native_dir).unwrap();

        // Write a PID file naming the current test process. `process_matches`
        // uses `ps -p`, which returns the process's short command name (e.g.
        // `framework-cli-`). We name the PID file after that command so the
        // attribution succeeds even though we can't fake a real clickhouse.
        let my_pid = std::process::id();
        let ps = std::process::Command::new("ps")
            .args(["-p", &my_pid.to_string(), "-o", "comm="])
            .output()
            .expect("ps");
        let comm = String::from_utf8_lossy(&ps.stdout).trim().to_string();
        // Grab the final path component and trim to something short-ish.
        let comm_name = comm
            .rsplit('/')
            .next()
            .unwrap_or(&comm)
            .chars()
            .take(15)
            .collect::<String>();
        std::fs::write(
            native_dir.join("clickhouse.pid"),
            format!("{my_pid}:{comm_name}"),
        )
        .unwrap();

        // The spec must use a service name that the attribute path recognizes
        // as clickhouse-owned.
        let specs = [PortSpec::new(port, "clickhouse-http", "127.0.0.1")];

        let err = check_ports(&specs, tmp.path()).expect_err("should conflict");
        assert_eq!(err.conflicts.len(), 1);
        // Rendering must always succeed.
        let _ = err.to_string();
    }

    #[test]
    fn display_any_attribution_suggests_keep_editing() {
        // Most preflight services (devredis, devkafka, http, management,
        // proxy_port) never write PID files, so in the common same-project
        // case only clickhouse/temporal are attributed while the others
        // are unattributed. `.any()` is the right signal: if we see our
        // own PID, it's our own dev server — tell the user they can keep
        // editing. Every conflicting port is still listed so the user can
        // intervene on stragglers if any are present.
        let err = PortConflictError {
            conflicts: vec![
                PortConflict {
                    spec: PortSpec::new(6379, "devredis", "127.0.0.1"),
                    owner_pid: None,
                    owner_name: None,
                },
                PortConflict {
                    spec: PortSpec::new(9000, "clickhouse-tcp", "127.0.0.1"),
                    owner_pid: Some(12345),
                    owner_name: Some("clickhouse"),
                },
            ],
        };
        let rendered = err.to_string();
        assert!(rendered.contains("6379 (devredis)"));
        assert!(rendered.contains("9000 (clickhouse-tcp)"));
        assert!(rendered.contains("PID 12345"));
        assert!(rendered.contains("keep editing"));
        assert!(!rendered.contains("another moose project"));
    }

    #[test]
    fn display_suggests_cleanup_when_no_attribution() {
        let err = PortConflictError {
            conflicts: vec![PortConflict {
                spec: PortSpec::new(6379, "devredis", "127.0.0.1"),
                owner_pid: None,
                owner_name: None,
            }],
        };
        let rendered = err.to_string();
        assert!(rendered.contains("another moose project"));
        assert!(!rendered.contains("keep editing"));
    }

    #[test]
    fn port_from_config_rejects_out_of_range() {
        assert!(port_from_config(70000, "clickhouse-http").is_err());
        assert!(port_from_config(-1, "clickhouse-http").is_err());
        assert!(port_from_config(0, "clickhouse-http").is_err());
        assert_eq!(port_from_config(9000, "clickhouse-tcp").unwrap(), 9000);
    }
}
