use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebApp {
    pub name: String,
    pub mount_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WebAppMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebAppMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

impl WebApp {
    pub fn new(name: String, mount_path: String) -> Self {
        Self {
            name,
            mount_path,
            metadata: None,
        }
    }

    pub fn with_metadata(mut self, metadata: WebAppMetadata) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

pub fn diff_web_apps(
    current: &HashMap<String, WebApp>,
    target: &HashMap<String, WebApp>,
) -> (Vec<WebApp>, Vec<WebApp>, Vec<(WebApp, WebApp)>) {
    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut updated = Vec::new();

    for (name, target_app) in target {
        match current.get(name) {
            Some(current_app) if current_app != target_app => {
                updated.push((current_app.clone(), target_app.clone()));
            }
            None => {
                added.push(target_app.clone());
            }
            _ => {}
        }
    }

    for (name, current_app) in current {
        if !target.contains_key(name) {
            removed.push(current_app.clone());
        }
    }

    (added, removed, updated)
}
