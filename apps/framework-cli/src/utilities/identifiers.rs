/// Language-agnostic identifier sanitization.
/// - Replaces common non-identifier separators with underscores
/// - Collapses consecutive underscores
/// - Trims leading/trailing underscores
pub fn sanitize_identifier(raw: &str) -> String {
    let mut s = raw
        .chars()
        .map(|c| match c {
            ' ' | '.' | '-' | '/' | ':' | ';' | ',' | '\\' => '_',
            _ => c,
        })
        .collect::<String>();
    // Collapse multiple underscores
    while s.contains("__") {
        s = s.replace("__", "_");
    }
    // Trim but keep at least one underscore if empty
    let s = s.trim_matches('_').to_string();
    if s.is_empty() {
        "_".to_string()
    } else {
        s
    }
}
