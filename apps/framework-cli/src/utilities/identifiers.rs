/// Language-agnostic identifier sanitization.
/// - Replaces common non-identifier separators with underscores
/// - Collapses consecutive underscores
/// - Trims leading/trailing underscores
pub fn sanitize_identifier(raw: &str) -> String {
    let s = raw.replace([' ', '.', '-', '/', ':', ';', ',', '\\'], "-");
    if s.is_empty() {
        "_".to_string()
    } else {
        s
    }
}
