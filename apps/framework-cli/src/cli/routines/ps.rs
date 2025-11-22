use std::{
    process::{Command, Stdio},
    sync::Arc,
};

use tracing::error;

use crate::{
    cli::display::{show_table, Message},
    project::Project,
};

use super::{RoutineFailure, RoutineSuccess};

pub struct MooseProcess {
    pub name: String,
    pub pid: u32,
    pub port: u16,
    pub config: String,
}

impl MooseProcess {
    pub fn new(name: String, pid: u32, port: u16, config: String) -> Self {
        Self {
            name,
            pid,
            port,
            config,
        }
    }
}

pub fn show_processes(project: Arc<Project>) -> Result<RoutineSuccess, RoutineFailure> {
    let processes = vec![
        get_webserver_process(&project),
        get_clickhouse_process(&project),
        get_redpanda_process(&project),
    ];

    let data: Vec<Vec<String>> = processes
        .into_iter()
        .filter_map(|process| {
            process.map(|p| vec![p.name, p.pid.to_string(), p.port.to_string(), p.config])
        })
        .collect();

    show_table(
        String::default(),
        vec![
            "Name".to_string(),
            "Process ID".to_string(),
            "Port".to_string(),
            "Access Credentials".to_string(),
        ],
        data,
    );

    Ok(RoutineSuccess::success(Message::new(
        "".to_string(),
        "".to_string(),
    )))
}

fn get_webserver_process(project: &Arc<Project>) -> Option<MooseProcess> {
    get_process_by_port(project.http_server_config.port, "moose", None, "N/A")
}

fn get_redpanda_process(project: &Arc<Project>) -> Option<MooseProcess> {
    let broker = &project.redpanda_config.broker;
    let parts: Vec<&str> = broker.split(':').collect();
    if parts.len() < 2 {
        error!("Invalid broker format: {}", broker);
        return None;
    }
    let port = match parts[1].parse::<u16>() {
        Ok(port) => port,
        Err(_) => {
            error!("Failed to parse port number: {}", parts[1]);
            return None;
        }
    };

    let config_string = serde_json::to_string_pretty(&project.redpanda_config).unwrap();
    get_process_by_port(port, "redpanda", Some(format!("*:{port}")), &config_string)
}

fn get_clickhouse_process(project: &Arc<Project>) -> Option<MooseProcess> {
    let config_string = serde_json::to_string_pretty(&project.clickhouse_config).unwrap();
    get_process_by_port(
        project.clickhouse_config.host_port as u16,
        "clickhouse",
        Some(format!("*:{}", project.clickhouse_config.host_port)),
        &config_string,
    )
}

fn get_process_by_port(
    port: u16,
    process_name: &str,
    filter: Option<String>,
    config: &str,
) -> Option<MooseProcess> {
    let output = Command::new("lsof")
        .arg("-i")
        .arg(format!(":{port}"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            error!("Failed to spawn process: {}", e);
        })
        .and_then(|child| {
            child.wait_with_output().map_err(|e| {
                error!("Failed to wait for process output: {}", e);
            })
        });

    let output = match output {
        Ok(output) => output,
        Err(_) => return None,
    };

    if !output.status.success() {
        error!(
            "Failed to get {} process: {}",
            process_name,
            String::from_utf8_lossy(&output.stderr)
        );
        return None;
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    // Skip the first line which contains the column headers
    let lines: Vec<&str> = output_str.split('\n').skip(1).collect();
    let filtered_lines: Vec<&str> = match &filter {
        Some(filter_str) => lines
            .into_iter()
            .filter(|line| line.contains(filter_str))
            .collect(),
        None => lines,
    };

    if filtered_lines.is_empty() {
        error!(
            "No lines containing '{:?}' found in lsof output: {}",
            filter, output_str
        );
        return None;
    }

    let parts: Vec<&str> = filtered_lines[0].split_whitespace().collect();
    if parts.len() < 2 {
        error!("Unexpected lsof output: {}", filtered_lines[0]);
        return None;
    }

    let pid = parts[1].parse::<u32>().ok().or_else(|| {
        error!("Failed to parse PID: {}", parts[1]);
        None
    })?;

    Some(MooseProcess::new(
        process_name.to_string(),
        pid,
        port,
        config.to_string(),
    ))
}
