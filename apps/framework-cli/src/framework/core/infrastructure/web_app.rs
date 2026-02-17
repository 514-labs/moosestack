use super::InfrastructureSignature;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WebApp {
    pub name: String,
    pub mount_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WebAppMetadata>,
    #[serde(default)]
    pub pulls_data_from: Vec<InfrastructureSignature>,
    #[serde(default)]
    pub pushes_data_to: Vec<InfrastructureSignature>,
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
            pulls_data_from: vec![],
            pushes_data_to: vec![],
        }
    }

    pub fn with_metadata(mut self, metadata: WebAppMetadata) -> Self {
        self.metadata = Some(metadata);
        self
    }

    pub fn to_proto(&self) -> crate::proto::infrastructure_map::WebApp {
        crate::proto::infrastructure_map::WebApp {
            name: self.name.clone(),
            mount_path: self.mount_path.clone(),
            metadata: self.metadata.as_ref().map(|m| m.to_proto()).into(),
            pulls_data_from: self.pulls_data_from.iter().map(|s| s.to_proto()).collect(),
            pushes_data_to: self.pushes_data_to.iter().map(|s| s.to_proto()).collect(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: &crate::proto::infrastructure_map::WebApp) -> Self {
        Self {
            name: proto.name.clone(),
            mount_path: proto.mount_path.clone(),
            metadata: proto.metadata.as_ref().map(WebAppMetadata::from_proto),
            pulls_data_from: proto
                .pulls_data_from
                .iter()
                .cloned()
                .map(InfrastructureSignature::from_proto)
                .collect(),
            pushes_data_to: proto
                .pushes_data_to
                .iter()
                .cloned()
                .map(InfrastructureSignature::from_proto)
                .collect(),
        }
    }
}

impl WebAppMetadata {
    pub fn to_proto(&self) -> crate::proto::infrastructure_map::WebAppMetadata {
        crate::proto::infrastructure_map::WebAppMetadata {
            description: self.description.clone(),
            special_fields: Default::default(),
        }
    }

    pub fn from_proto(proto: &crate::proto::infrastructure_map::WebAppMetadata) -> Self {
        Self {
            description: proto.description.clone(),
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webapp_proto_roundtrip_preserves_lineage() {
        let web_app = WebApp {
            name: "lineageWebApp".to_string(),
            mount_path: "/lineage".to_string(),
            metadata: Some(WebAppMetadata {
                description: Some("Lineage test".to_string()),
            }),
            pulls_data_from: vec![InfrastructureSignature::Table {
                id: "Orders".to_string(),
            }],
            pushes_data_to: vec![InfrastructureSignature::Topic {
                id: "OrdersEvents".to_string(),
            }],
        };

        let proto = web_app.to_proto();
        let roundtrip = WebApp::from_proto(&proto);
        assert_eq!(roundtrip, web_app);
    }
}
