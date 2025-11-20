//! Module for language-specific string format handling and escaping.
//!
//! Provides delimiter-aware SQL escaping for Python and TypeScript string literals.

use crate::cli::display::Message;
use crate::cli::routines::RoutineFailure;

/// Supported string literal formats across languages
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StringFormat {
    // Python raw strings
    PythonRawTripleDouble, // r"""
    PythonRawTripleSingle, // r'''
    PythonRawDouble,       // r"
    PythonRawSingle,       // r'

    // Python regular strings
    PythonTripleDouble, // """
    PythonTripleSingle, // '''
    PythonDouble,       // "
    PythonSingle,       // '

    // Python f-strings
    PythonFStringTripleDouble, // f"""
    PythonFStringTripleSingle, // f'''
    PythonFStringDouble,       // f"
    PythonFStringSingle,       // f'

    // TypeScript/JavaScript
    TypeScriptTemplate, // `
    TypeScriptDouble,   // "
    TypeScriptSingle,   // '
}

impl StringFormat {
    /// Parse delimiter string into StringFormat enum with language context
    ///
    /// # Arguments
    ///
    /// * `delimiter` - The delimiter string (e.g., `r"""`, `` ` ``, `"`)
    /// * `language` - Optional language context to disambiguate `"` and `'` between Python and TypeScript
    ///
    /// # Returns
    ///
    /// * `Result<Self, RoutineFailure>` - The parsed StringFormat or error
    pub fn from_delimiter(
        delimiter: &str,
        language: Option<crate::cli::routines::format_query::CodeLanguage>,
    ) -> Result<Self, RoutineFailure> {
        use crate::cli::routines::format_query::CodeLanguage;

        match delimiter {
            // Python raw strings
            r#"r""""# => Ok(StringFormat::PythonRawTripleDouble),
            r"r'''" => Ok(StringFormat::PythonRawTripleSingle),
            r#"r""# => Ok(StringFormat::PythonRawDouble),
            r"r'" => Ok(StringFormat::PythonRawSingle),

            // Python regular strings (unambiguous)
            r#"""""# => Ok(StringFormat::PythonTripleDouble),
            r"'''" => Ok(StringFormat::PythonTripleSingle),

            // Python f-strings
            r#"f""""# => Ok(StringFormat::PythonFStringTripleDouble),
            r"f'''" => Ok(StringFormat::PythonFStringTripleSingle),
            r#"f""# => Ok(StringFormat::PythonFStringDouble),
            r"f'" => Ok(StringFormat::PythonFStringSingle),

            // TypeScript/JavaScript (unambiguous)
            r"`" => Ok(StringFormat::TypeScriptTemplate),

            // Ambiguous delimiters: " and ' (need language context)
            r#"""# => match language {
                Some(CodeLanguage::TypeScript) => Ok(StringFormat::TypeScriptDouble),
                _ => Ok(StringFormat::PythonDouble), // Default to Python
            },
            r"'" => match language {
                Some(CodeLanguage::TypeScript) => Ok(StringFormat::TypeScriptSingle),
                _ => Ok(StringFormat::PythonSingle), // Default to Python
            },

            _ => Err(RoutineFailure::error(Message::new(
                "String Format".to_string(),
                format!(
                    "Unsupported delimiter: '{}'. Supported: r\"\"\", r''', r\", r', \"\"\", ''', \", ', f\"\"\", f''', f\", f', `",
                    delimiter
                ),
            ))),
        }
    }

    /// Check if SQL content conflicts with this string format
    pub fn has_conflict(&self, sql: &str) -> bool {
        match self {
            // Python raw triple-quote: conflicts if contains delimiter sequence
            StringFormat::PythonRawTripleDouble => sql.contains(r#"""""#),
            StringFormat::PythonRawTripleSingle => sql.contains(r"'''"),

            // Python raw single-quote: conflicts if ends with odd backslashes or contains delimiter
            StringFormat::PythonRawDouble => {
                sql.contains('"') || self.ends_with_odd_backslashes(sql)
            }
            StringFormat::PythonRawSingle => {
                sql.contains('\'') || self.ends_with_odd_backslashes(sql)
            }

            // Python regular strings: conflicts if contains triple delimiter
            StringFormat::PythonTripleDouble => sql.contains(r#"""""#),
            StringFormat::PythonTripleSingle => sql.contains(r"'''"),
            StringFormat::PythonDouble => sql.contains('"'),
            StringFormat::PythonSingle => sql.contains('\''),

            // Python f-strings: conflicts if contains braces or triple delimiter
            StringFormat::PythonFStringTripleDouble => {
                sql.contains(r#"""""#) || sql.contains('{') || sql.contains('}')
            }
            StringFormat::PythonFStringTripleSingle => {
                sql.contains(r"'''") || sql.contains('{') || sql.contains('}')
            }
            StringFormat::PythonFStringDouble => {
                sql.contains('"') || sql.contains('{') || sql.contains('}')
            }
            StringFormat::PythonFStringSingle => {
                sql.contains('\'') || sql.contains('{') || sql.contains('}')
            }

            // TypeScript: conflicts if contains delimiter or interpolation syntax
            StringFormat::TypeScriptTemplate => sql.contains('`') || sql.contains("${"),
            StringFormat::TypeScriptDouble => sql.contains('"'),
            StringFormat::TypeScriptSingle => sql.contains('\''),
        }
    }

    /// Check if string ends with odd number of backslashes (problematic for raw strings)
    fn ends_with_odd_backslashes(&self, s: &str) -> bool {
        let trailing_backslashes = s.chars().rev().take_while(|&c| c == '\\').count();
        trailing_backslashes % 2 == 1
    }

    /// Get the next safer fallback format, or None if no fallback exists
    pub fn fallback(&self) -> Option<StringFormat> {
        match self {
            // Python raw triple-quote -> raw single quote alternatives -> regular strings
            StringFormat::PythonRawTripleDouble => Some(StringFormat::PythonRawTripleSingle),
            StringFormat::PythonRawTripleSingle => Some(StringFormat::PythonTripleDouble),

            // Python raw single-quote -> regular triple-quote (safer)
            StringFormat::PythonRawDouble => Some(StringFormat::PythonTripleDouble),
            StringFormat::PythonRawSingle => Some(StringFormat::PythonTripleSingle),

            // Python regular triple-quote -> opposite quote type
            StringFormat::PythonTripleDouble => Some(StringFormat::PythonTripleSingle),
            StringFormat::PythonTripleSingle => None, // Last resort

            // Python regular single-quote -> triple-quote (safer for multi-line)
            StringFormat::PythonDouble => Some(StringFormat::PythonTripleDouble),
            StringFormat::PythonSingle => Some(StringFormat::PythonTripleSingle),

            // Python f-strings -> regular strings (lose interpolation but safer)
            StringFormat::PythonFStringTripleDouble => Some(StringFormat::PythonTripleDouble),
            StringFormat::PythonFStringTripleSingle => Some(StringFormat::PythonTripleSingle),
            StringFormat::PythonFStringDouble => Some(StringFormat::PythonDouble),
            StringFormat::PythonFStringSingle => Some(StringFormat::PythonSingle),

            // TypeScript template -> double quote -> single quote
            StringFormat::TypeScriptTemplate => Some(StringFormat::TypeScriptDouble),
            StringFormat::TypeScriptDouble => Some(StringFormat::TypeScriptSingle),
            StringFormat::TypeScriptSingle => None, // Last resort
        }
    }

    /// Resolve format with automatic fallback if SQL conflicts with chosen format
    pub fn resolve(&self, sql: &str) -> StringFormat {
        let mut current = *self;

        while current.has_conflict(sql) {
            if let Some(fallback) = current.fallback() {
                current = fallback;
            } else {
                // No more fallbacks, use current even with conflict
                // This case requires escaping to handle
                break;
            }
        }

        current
    }

    /// Escape SQL content for this string format
    pub fn escape(&self, sql: &str) -> String {
        match self {
            StringFormat::PythonRawTripleDouble => self.escape_python_raw_triple_double(sql),
            StringFormat::PythonRawTripleSingle => self.escape_python_raw_triple_single(sql),
            StringFormat::PythonRawDouble => sql.to_string(), // Not implemented yet
            StringFormat::PythonRawSingle => sql.to_string(), // Not implemented yet
            StringFormat::PythonTripleDouble => self.escape_python_triple_double(sql),
            StringFormat::PythonTripleSingle => self.escape_python_triple_single(sql),
            StringFormat::PythonDouble => self.escape_python_double(sql),
            StringFormat::PythonSingle => self.escape_python_single(sql),
            StringFormat::PythonFStringTripleDouble => {
                self.escape_python_fstring_triple_double(sql)
            }
            StringFormat::PythonFStringTripleSingle => {
                self.escape_python_fstring_triple_single(sql)
            }
            StringFormat::PythonFStringDouble => self.escape_python_fstring_double(sql),
            StringFormat::PythonFStringSingle => self.escape_python_fstring_single(sql),
            StringFormat::TypeScriptTemplate => self.escape_typescript_template(sql),
            StringFormat::TypeScriptDouble => self.escape_typescript_double(sql),
            StringFormat::TypeScriptSingle => self.escape_typescript_single(sql),
        }
    }

    fn escape_python_raw_triple_double(&self, sql: &str) -> String {
        // Escape """ sequences
        sql.replace(r#"""""#, r#"\"\"\""#)
    }

    fn escape_python_raw_triple_single(&self, sql: &str) -> String {
        // Escape ''' sequences
        sql.replace(r"'''", r"\'\'\'")
    }

    fn escape_python_triple_double(&self, sql: &str) -> String {
        sql.replace('\\', r"\\").replace(r#"""""#, r#"\"\"\""#)
    }

    fn escape_python_triple_single(&self, sql: &str) -> String {
        sql.replace('\\', r"\\").replace(r"'''", r"\'\'\'")
    }

    fn escape_python_double(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('"', r#"\""#)
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    fn escape_python_single(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('\'', r"\'")
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    fn escape_python_fstring_triple_double(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('{', "{{")
            .replace('}', "}}")
            .replace(r#"""""#, r#"\"\"\""#)
    }

    fn escape_python_fstring_triple_single(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('{', "{{")
            .replace('}', "}}")
            .replace(r"'''", r"\'\'\'")
    }

    fn escape_python_fstring_double(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('{', "{{")
            .replace('}', "}}")
            .replace('"', r#"\""#)
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    fn escape_python_fstring_single(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('{', "{{")
            .replace('}', "}}")
            .replace('\'', r"\'")
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    fn escape_typescript_template(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('`', r"\`")
            .replace("${", r"\${")
    }

    fn escape_typescript_double(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('"', r#"\""#)
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    fn escape_typescript_single(&self, sql: &str) -> String {
        sql.replace('\\', r"\\")
            .replace('\'', r"\'")
            .replace('\n', r"\n")
            .replace('\r', r"\r")
            .replace('\t', r"\t")
    }

    /// Wrap escaped SQL with appropriate delimiters
    pub fn wrap(&self, sql: &str) -> String {
        let trimmed = sql.trim();

        match self {
            // Python raw strings
            StringFormat::PythonRawTripleDouble => format!("r\"\"\"\n{}\n\"\"\"", trimmed),
            StringFormat::PythonRawTripleSingle => format!("r'''\n{}\n'''", trimmed),
            StringFormat::PythonRawDouble => format!("r\"{}\"", trimmed),
            StringFormat::PythonRawSingle => format!("r'{}'", trimmed),

            // Python regular strings
            StringFormat::PythonTripleDouble => format!("\"\"\"\n{}\n\"\"\"", trimmed),
            StringFormat::PythonTripleSingle => format!("'''\n{}\n'''", trimmed),
            StringFormat::PythonDouble => format!("\"{}\"", trimmed),
            StringFormat::PythonSingle => format!("'{}'", trimmed),

            // Python f-strings
            StringFormat::PythonFStringTripleDouble => format!("f\"\"\"\n{}\n\"\"\"", trimmed),
            StringFormat::PythonFStringTripleSingle => format!("f'''\n{}\n'''", trimmed),
            StringFormat::PythonFStringDouble => format!("f\"{}\"", trimmed),
            StringFormat::PythonFStringSingle => format!("f'{}'", trimmed),

            // TypeScript
            StringFormat::TypeScriptTemplate => format!("`\n{}\n`", trimmed),
            StringFormat::TypeScriptDouble => format!("\"{}\"", trimmed),
            StringFormat::TypeScriptSingle => format!("'{}'", trimmed),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_python_raw_triple_double() {
        let format = StringFormat::from_delimiter(r#"r""""#, None).unwrap();
        assert!(matches!(format, StringFormat::PythonRawTripleDouble));
    }

    #[test]
    fn test_parse_all_python_raw_delimiters() {
        assert!(matches!(
            StringFormat::from_delimiter(r#"r""""#, None).unwrap(),
            StringFormat::PythonRawTripleDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"r'''", None).unwrap(),
            StringFormat::PythonRawTripleSingle
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r#"r""#, None).unwrap(),
            StringFormat::PythonRawDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"r'", None).unwrap(),
            StringFormat::PythonRawSingle
        ));
    }

    #[test]
    fn test_parse_all_python_regular_delimiters() {
        assert!(matches!(
            StringFormat::from_delimiter(r#"""""#, None).unwrap(),
            StringFormat::PythonTripleDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"'''", None).unwrap(),
            StringFormat::PythonTripleSingle
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r#"""#, None).unwrap(),
            StringFormat::PythonDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"'", None).unwrap(),
            StringFormat::PythonSingle
        ));
    }

    #[test]
    fn test_parse_all_python_fstring_delimiters() {
        assert!(matches!(
            StringFormat::from_delimiter(r#"f""""#, None).unwrap(),
            StringFormat::PythonFStringTripleDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"f'''", None).unwrap(),
            StringFormat::PythonFStringTripleSingle
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r#"f""#, None).unwrap(),
            StringFormat::PythonFStringDouble
        ));
        assert!(matches!(
            StringFormat::from_delimiter(r"f'", None).unwrap(),
            StringFormat::PythonFStringSingle
        ));
    }

    #[test]
    fn test_parse_all_typescript_delimiters() {
        assert!(matches!(
            StringFormat::from_delimiter(r"`", None).unwrap(),
            StringFormat::TypeScriptTemplate
        ));
        // Note: " and ' are ambiguous and resolve to Python by default
        // In practice, these are disambiguated by language context in format_query.rs
    }

    #[test]
    fn test_parse_invalid_delimiter() {
        assert!(StringFormat::from_delimiter("invalid", None).is_err());
        assert!(StringFormat::from_delimiter("", None).is_err());
    }

    #[test]
    fn test_python_raw_triple_double_detects_conflict() {
        let format = StringFormat::PythonRawTripleDouble;

        // No conflict
        assert!(!format.has_conflict(r#"SELECT * FROM users WHERE email = 'test@example.com'"#));

        // Has conflict - contains """
        assert!(format.has_conflict(r#"SELECT '"""' AS col"#));
        assert!(format.has_conflict(r#"SELECT * FROM t WHERE x = "test""""#));
    }

    #[test]
    fn test_python_raw_triple_single_detects_conflict() {
        let format = StringFormat::PythonRawTripleSingle;

        // No conflict
        assert!(!format.has_conflict(r#"SELECT * FROM users WHERE email = "test@example.com""#));

        // Has conflict - contains '''
        assert!(format.has_conflict(r"SELECT ''' AS col"));
    }

    #[test]
    fn test_python_fstring_detects_brace_conflict() {
        let format = StringFormat::PythonFStringTripleDouble;

        // No conflict
        assert!(!format.has_conflict(r#"SELECT * FROM users"#));

        // Has conflict - contains { or }
        assert!(format.has_conflict(r#"SELECT {'key': 'value'}"#));
        assert!(!format.has_conflict(r#"SELECT [1, 2, 3]"#));
    }

    #[test]
    fn test_typescript_template_detects_conflict() {
        let format = StringFormat::TypeScriptTemplate;

        // No conflict
        assert!(!format.has_conflict(r#"SELECT * FROM users WHERE price > 100"#));

        // Has conflict - contains ` or ${
        assert!(format.has_conflict(r"SELECT `column` FROM table"));
        assert!(format.has_conflict(r"SELECT '${var}' AS template"));
    }

    #[test]
    fn test_python_raw_trailing_backslash_conflict() {
        let format = StringFormat::PythonRawDouble;

        // No conflict - SQL doesn't end with backslash
        assert!(!format.has_conflict(r"SELECT * FROM users WHERE path LIKE 'C:\\Users\\%'"));

        // Has conflict - SQL literally ends with backslash (would escape closing delimiter)
        assert!(format.has_conflict(r"SELECT * FROM t WHERE x = 'value'\"));
        assert!(!format.has_conflict(r"SELECT * FROM t WHERE x = 'value'\\"));
        // Three backslashes at end (odd number)
        assert!(format.has_conflict(r"SELECT * FROM t WHERE x = 'value'\\\"));
    }

    #[test]
    fn test_python_raw_triple_double_fallback_chain() {
        let format = StringFormat::PythonRawTripleDouble;
        assert_eq!(format.fallback(), Some(StringFormat::PythonRawTripleSingle));

        let fallback1 = format.fallback().unwrap();
        assert_eq!(fallback1.fallback(), Some(StringFormat::PythonTripleDouble));

        let fallback2 = fallback1.fallback().unwrap();
        assert_eq!(fallback2.fallback(), Some(StringFormat::PythonTripleSingle));

        let fallback3 = fallback2.fallback().unwrap();
        assert_eq!(fallback3.fallback(), None);
    }

    #[test]
    fn test_typescript_template_fallback_chain() {
        let format = StringFormat::TypeScriptTemplate;
        assert_eq!(format.fallback(), Some(StringFormat::TypeScriptDouble));

        let fallback1 = format.fallback().unwrap();
        assert_eq!(fallback1.fallback(), Some(StringFormat::TypeScriptSingle));

        let fallback2 = fallback1.fallback().unwrap();
        assert_eq!(fallback2.fallback(), None);
    }

    #[test]
    fn test_resolve_with_no_conflict() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = "SELECT * FROM users WHERE id = 1";

        let resolved = format.resolve(sql);
        assert_eq!(resolved, StringFormat::PythonRawTripleDouble);
    }

    #[test]
    fn test_resolve_with_conflict_uses_fallback() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = r#"SELECT '"""' AS col"#;

        let resolved = format.resolve(sql);
        assert_eq!(resolved, StringFormat::PythonRawTripleSingle);
    }

    #[test]
    fn test_resolve_with_multiple_conflicts() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = r#"SELECT '"""' AS col1, ''' AS col2"#;

        let resolved = format.resolve(sql);
        // Both """ and ''' conflict, so we fallback through the entire chain
        // and end up at the last resort: PythonTripleSingle
        assert_eq!(resolved, StringFormat::PythonTripleSingle);
    }

    #[test]
    fn test_escape_python_raw_triple_double_no_conflict() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = r"SELECT * FROM users WHERE email REGEXP '[a-z]+'";

        let escaped = format.escape(sql);
        assert_eq!(escaped, sql); // No escaping needed
    }

    #[test]
    fn test_escape_python_raw_triple_double_with_conflict() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = r#"SELECT '"""' AS col"#;

        let escaped = format.escape(sql);
        // Should escape the """ sequence
        assert!(escaped.contains(r#"\"\"\""#));
    }

    #[test]
    fn test_escape_python_raw_preserves_backslashes() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = r"SELECT * FROM logs WHERE message REGEXP '\\d{4}-\\d{2}'";

        let escaped = format.escape(sql);
        // Raw strings preserve backslashes
        assert!(escaped.contains(r"\\d{4}"));
    }

    #[test]
    fn test_escape_python_triple_double_basic() {
        let format = StringFormat::PythonTripleDouble;
        let sql = r"SELECT * FROM users WHERE name = 'test'";

        let escaped = format.escape(sql);
        // Single quotes don't need escaping in triple-double
        assert_eq!(escaped, sql);
    }

    #[test]
    fn test_escape_python_triple_double_with_backslash() {
        let format = StringFormat::PythonTripleDouble;
        let sql = r"SELECT * FROM logs WHERE path LIKE 'C:\Users\%'";

        let escaped = format.escape(sql);
        // Backslashes need escaping
        assert!(escaped.contains(r"C:\\Users\\"));
    }

    #[test]
    fn test_escape_python_double_with_quotes() {
        let format = StringFormat::PythonDouble;
        let sql = r#"SELECT * FROM users WHERE email = "test@example.com""#;

        let escaped = format.escape(sql);
        // Double quotes need escaping
        assert!(escaped.contains(r#"email = \"test@example.com\""#));
    }

    #[test]
    fn test_escape_python_double_with_newlines() {
        let format = StringFormat::PythonDouble;
        let sql = "SELECT *\nFROM users\nWHERE id = 1";

        let escaped = format.escape(sql);
        // Newlines need escaping
        assert!(escaped.contains(r"SELECT *\nFROM users\nWHERE id = 1"));
    }

    #[test]
    fn test_escape_python_fstring_triple_double_basic() {
        let format = StringFormat::PythonFStringTripleDouble;
        let sql = r"SELECT * FROM users WHERE name = 'test'";

        let escaped = format.escape(sql);
        assert_eq!(escaped, sql);
    }

    #[test]
    fn test_escape_python_fstring_with_braces() {
        let format = StringFormat::PythonFStringTripleDouble;
        let sql = r#"SELECT {'key': 'value'} AS json"#;

        let escaped = format.escape(sql);
        // Braces need doubling
        assert!(escaped.contains(r#"{{'key': 'value'}}"#));
    }

    #[test]
    fn test_escape_python_fstring_with_backslash_and_braces() {
        let format = StringFormat::PythonFStringTripleDouble;
        let sql = r"SELECT * FROM t WHERE path = 'C:\Users\{user}'";

        let escaped = format.escape(sql);
        // Both backslashes and braces need escaping
        assert!(escaped.contains(r"C:\\Users\\{{user}}"));
    }

    #[test]
    fn test_escape_typescript_template_basic() {
        let format = StringFormat::TypeScriptTemplate;
        let sql = r"SELECT * FROM users WHERE id = 1";

        let escaped = format.escape(sql);
        assert_eq!(escaped, sql);
    }

    #[test]
    fn test_escape_typescript_template_with_backticks() {
        let format = StringFormat::TypeScriptTemplate;
        let sql = r"SELECT `column_name` FROM table";

        let escaped = format.escape(sql);
        assert!(escaped.contains(r"\`column_name\`"));
    }

    #[test]
    fn test_escape_typescript_template_with_interpolation() {
        let format = StringFormat::TypeScriptTemplate;
        let sql = r"SELECT * FROM t WHERE price > ${100}";

        let escaped = format.escape(sql);
        assert!(escaped.contains(r"\${100}"));
    }

    #[test]
    fn test_escape_typescript_double_with_quotes() {
        let format = StringFormat::TypeScriptDouble;
        let sql = r#"SELECT * FROM users WHERE email = "test@example.com""#;

        let escaped = format.escape(sql);
        assert!(escaped.contains(r#"email = \"test@example.com\""#));
    }

    #[test]
    fn test_escape_typescript_double_with_newlines() {
        let format = StringFormat::TypeScriptDouble;
        let sql = "SELECT *\nFROM users\nWHERE id = 1";

        let escaped = format.escape(sql);
        assert!(escaped.contains(r"SELECT *\nFROM users\nWHERE id = 1"));
    }

    #[test]
    fn test_wrap_python_raw_triple_double() {
        let format = StringFormat::PythonRawTripleDouble;
        let sql = "SELECT * FROM users";

        let wrapped = format.wrap(sql);
        assert_eq!(wrapped, "r\"\"\"\nSELECT * FROM users\n\"\"\"");
    }

    #[test]
    fn test_wrap_python_fstring_triple_double() {
        let format = StringFormat::PythonFStringTripleDouble;
        let sql = "SELECT * FROM users";

        let wrapped = format.wrap(sql);
        assert_eq!(wrapped, "f\"\"\"\nSELECT * FROM users\n\"\"\"");
    }

    #[test]
    fn test_wrap_typescript_template() {
        let format = StringFormat::TypeScriptTemplate;
        let sql = "SELECT * FROM users";

        let wrapped = format.wrap(sql);
        assert_eq!(wrapped, "`\nSELECT * FROM users\n`");
    }

    #[test]
    fn test_wrap_typescript_double() {
        let format = StringFormat::TypeScriptDouble;
        let sql = "SELECT * FROM users";

        let wrapped = format.wrap(sql);
        assert_eq!(wrapped, "\"SELECT * FROM users\"");
    }
}
