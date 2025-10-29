// Module for handling embedded documentation as MCP resources

use rmcp::model::{
    Annotated, ListResourcesResult, RawResource, ReadResourceResult, ResourceContents,
};

#[path = "generated_docs.rs"]
mod generated_docs;
use generated_docs::EMBEDDED_DOCS;

/// List all available documentation resources
pub fn list_resources() -> ListResourcesResult {
    let resources: Vec<Annotated<RawResource>> = EMBEDDED_DOCS
        .iter()
        .map(|doc| Annotated {
            raw: RawResource {
                uri: doc.uri.to_string(),
                name: doc.name.to_string(),
                title: Some(doc.title.to_string()),
                description: Some(doc.description.to_string()),
                mime_type: Some("text/markdown".to_string()),
                size: Some(doc.content.len() as u32),
                icons: None,
            },
            annotations: None,
        })
        .collect();

    ListResourcesResult {
        resources,
        next_cursor: None,
    }
}

/// Read a specific documentation resource by URI
pub fn read_resource(uri: &str) -> Option<ReadResourceResult> {
    EMBEDDED_DOCS
        .iter()
        .find(|doc| doc.uri == uri)
        .map(|doc| ReadResourceResult {
            contents: vec![ResourceContents::TextResourceContents {
                uri: doc.uri.to_string(),
                mime_type: Some("text/markdown".to_string()),
                text: doc.content.to_string(),
                meta: None,
            }],
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_resources_returns_all_docs() {
        let result = list_resources();
        assert_eq!(result.resources.len(), EMBEDDED_DOCS.len());
        assert!(!result.resources.is_empty(), "Should have embedded docs");
    }

    #[test]
    fn test_all_resources_have_required_fields() {
        let result = list_resources();
        for resource in &result.resources {
            assert!(!resource.raw.uri.is_empty());
            assert!(!resource.raw.name.is_empty());
            assert!(resource.raw.title.is_some());
            assert!(resource.raw.description.is_some());
            assert_eq!(resource.raw.mime_type.as_deref(), Some("text/markdown"));
            assert!(resource.raw.size.is_some());
            assert!(resource.raw.size.unwrap() > 0);
        }
    }

    #[test]
    fn test_resources_use_moose_uri_scheme() {
        let result = list_resources();
        for resource in &result.resources {
            assert!(
                resource.raw.uri.starts_with("moose://docs/"),
                "Resource URI should start with moose://docs/, got: {}",
                resource.raw.uri
            );
        }
    }

    #[test]
    fn test_read_resource_returns_content() {
        // Get the first resource URI
        let result = list_resources();
        assert!(!result.resources.is_empty());

        let first_uri = &result.resources[0].raw.uri;
        let read_result = read_resource(first_uri);

        assert!(read_result.is_some());
        let read_result = read_result.unwrap();
        assert_eq!(read_result.contents.len(), 1);

        match &read_result.contents[0] {
            ResourceContents::TextResourceContents {
                uri,
                text,
                mime_type,
                ..
            } => {
                assert_eq!(uri, first_uri);
                assert!(!text.is_empty());
                assert_eq!(mime_type.as_deref(), Some("text/markdown"));
            }
            _ => panic!("Expected TextResourceContents"),
        }
    }

    #[test]
    fn test_read_nonexistent_resource_returns_none() {
        let result = read_resource("moose://docs/nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn test_typescript_and_python_docs_exist() {
        let result = list_resources();

        let typescript_docs = result
            .resources
            .iter()
            .filter(|r| r.raw.uri.contains("/typescript/"))
            .count();

        let python_docs = result
            .resources
            .iter()
            .filter(|r| r.raw.uri.contains("/python/"))
            .count();

        assert!(typescript_docs > 0, "Should have TypeScript documentation");
        assert!(python_docs > 0, "Should have Python documentation");
    }

    #[test]
    fn test_high_priority_docs_first() {
        // Schema definition docs should be in the first few results (high priority)
        let result = list_resources();

        let schema_positions: Vec<_> = result
            .resources
            .iter()
            .enumerate()
            .filter(|(_, r)| r.raw.uri.contains("schema-definition"))
            .map(|(i, _)| i)
            .collect();

        assert!(!schema_positions.is_empty(), "Should have schema docs");
        assert!(
            schema_positions.iter().all(|&pos| pos < 5),
            "Schema docs should be in first 5 positions (high priority)"
        );
    }
}
