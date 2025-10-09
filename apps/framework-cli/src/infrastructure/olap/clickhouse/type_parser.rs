//! # ClickHouse Type Parser
//!
//! This module provides parsers and converters for ClickHouse data types.
//! It handles conversion between ClickHouse type strings and the framework's
//! type system, supporting complex nested structures and various type formats.

use crate::framework::core::infrastructure::table::{
    Column, ColumnType, DataEnum, EnumMember, EnumValue, FloatType, IntType, Nested,
};
use logos::Logos;
use std::fmt;
use thiserror::Error;

// =========================================================
// Error Types
// =========================================================

/// Errors that can occur during ClickHouse type tokenization
#[derive(Debug, Clone, PartialEq, Error)]
#[non_exhaustive]
pub enum TokenizerError {
    /// Invalid string format
    #[error("Invalid string literal: {message}")]
    InvalidString { message: String },

    /// Invalid number format
    #[error("Invalid number literal: {message}")]
    InvalidNumber { message: String },

    /// Unexpected character encountered
    #[error("Unexpected character '{character}' at position {position}")]
    UnexpectedCharacter { character: char, position: usize },

    /// Unterminated string literal
    #[error("Unterminated string literal starting at position {position}")]
    UnterminatedString { position: usize },

    /// Logos lexer error
    #[error("Lexer error at position {position}")]
    LexerError { position: usize },
}

/// Errors that can occur during ClickHouse type parsing
#[derive(Debug, Clone, PartialEq, Error)]
#[non_exhaustive]
pub enum ParseError {
    /// Unexpected token encountered during parsing
    #[error("Unexpected token: expected {expected}, found {found}")]
    UnexpectedToken { expected: String, found: String },

    /// End of input reached unexpectedly
    #[error("Unexpected end of input while parsing {context}")]
    UnexpectedEOF { context: &'static str },

    /// Missing parameter
    #[error("Missing parameter in {type_name}: {message}")]
    MissingParameter { type_name: String, message: String },

    /// Invalid parameter
    #[error("Invalid parameter in {type_name}: {message}")]
    InvalidParameter { type_name: String, message: String },

    /// General syntax error
    #[error("Syntax error: {message}")]
    SyntaxError { message: String },

    /// Unsupported type or feature
    #[error("Unsupported type: {type_name}")]
    UnsupportedType { type_name: String },

    /// Tokenizer error
    #[error("Tokenizer error: {0}")]
    TokenizerError(#[from] TokenizerError),
}

/// Errors that can occur during conversion from ClickHouse types to framework types
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ConversionError {
    /// The ClickHouse type doesn't have an equivalent in the framework type system
    #[error("Unsupported ClickHouse type: {type_name}")]
    UnsupportedType { type_name: String },

    /// The ClickHouse type's parameters are invalid or out of range
    #[error("Invalid type parameters for {type_name}: {message}")]
    InvalidParameters { type_name: String, message: String },

    /// Error during parsing of the ClickHouse type
    #[error("Parse error: {0}")]
    ParseError(#[from] ParseError),
}

/// Errors that can occur during the full ClickHouse type processing
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum ClickHouseTypeError {
    /// Error related to parsing the type string
    #[error("Error parsing ClickHouse type string '{input}': {source}")]
    Parse {
        input: String,
        #[source]
        source: ParseError,
    },

    /// Error related to converting a type to a framework type
    #[error("Error converting ClickHouse type to framework type: {source}")]
    Conversion {
        #[source]
        source: ConversionError,
    },
}

// =========================================================
// Token and AST definitions
// =========================================================

/// Represents a token in the ClickHouse type syntax
#[derive(Logos, Debug, Clone, PartialEq)]
enum Token {
    /// Identifier (type name, function name, etc.)
    #[regex(r"[a-zA-Z_][a-zA-Z0-9_]*", |lex| lex.slice().to_string())]
    Identifier(String),

    /// A string literal 'value' or "value"
    #[regex(r#"'([^'\\]|\\.)*'"#, |lex| {
        // Strip the quotes and handle escapes
        let content = lex.slice();
        let content = &content[1..content.len()-1]; // Remove quotes
        let mut result = String::with_capacity(content.len());
        let mut chars = content.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('\\') => result.push('\\'),
                    Some('\'') => result.push('\''),
                    Some('"') => result.push('"'),
                    Some('n') => result.push('\n'),
                    Some('r') => result.push('\r'),
                    Some('t') => result.push('\t'),
                    Some(c) => result.push(c),
                    None => break,
                }
            } else {
                result.push(c);
            }
        }
        result
    })]
    #[regex(r#""([^"\\]|\\.)*""#, |lex| {
        // Strip the quotes and handle escapes
        let content = lex.slice();
        let content = &content[1..content.len()-1]; // Remove quotes
        let mut result = String::with_capacity(content.len());
        let mut chars = content.chars();
        while let Some(c) = chars.next() {
            if c == '\\' {
                match chars.next() {
                    Some('\\') => result.push('\\'),
                    Some('\'') => result.push('\''),
                    Some('"') => result.push('"'),
                    Some('n') => result.push('\n'),
                    Some('r') => result.push('\r'),
                    Some('t') => result.push('\t'),
                    Some(c) => result.push(c),
                    None => break,
                }
            } else {
                result.push(c);
            }
        }
        result
    })]
    StringLiteral(String),

    /// A numeric literal
    #[regex(r"[0-9]+", |lex| lex.slice().parse::<u64>().unwrap_or_default())]
    NumberLiteral(u64),

    /// Left parenthesis (
    #[token("(")]
    LeftParen,

    /// Right parenthesis )
    #[token(")")]
    RightParen,

    /// Comma separator for parameters
    #[token(",")]
    Comma,

    /// Equals sign in enum definitions
    #[token("=")]
    Equals,

    /// Whitespace is skipped
    #[regex(r"[ \t\r\n\f]+", logos::skip)]
    /// Error token (for unrecognized input)
    #[regex(".", logos::skip, priority = 0)]
    Error,

    /// End of input marker (not produced by Logos, added manually)
    Eof,
}

/// Represents an AST node for a ClickHouse type
#[derive(Debug, Clone, PartialEq)]
pub enum ClickHouseTypeNode {
    /// Simple types without parameters (UInt8, String, etc.)
    Simple(String),

    /// Nullable(T)
    Nullable(Box<ClickHouseTypeNode>),

    /// Array(T)
    Array(Box<ClickHouseTypeNode>),

    /// LowCardinality(T)
    LowCardinality(Box<ClickHouseTypeNode>),

    /// Decimal with precision and scale
    Decimal { precision: u8, scale: u8 },

    /// Specialized Decimal with precision
    DecimalSized { bits: u16, precision: u8 },

    /// DateTime with optional timezone
    DateTime { timezone: Option<String> },

    /// DateTime64 with precision and optional timezone
    DateTime64 {
        precision: u8,
        timezone: Option<String>,
    },

    /// FixedString with length
    FixedString(u64),

    /// Nothing (special type representing absence of a value)
    Nothing,

    /// BFloat16 (brain floating point format)
    BFloat16,

    /// IPv4 type
    IPv4,

    /// IPv6 type
    IPv6,

    /// JSON type
    JSON,

    /// Dynamic type (for dynamic objects)
    Dynamic,

    /// Object type with optional parameters
    Object(Option<String>),

    /// Variant(T1, T2, ...) type for union types
    Variant(Vec<ClickHouseTypeNode>),

    /// Interval types
    Interval(String),

    /// Geo types
    Geo(String),

    /// Enum8 or Enum16 with members
    Enum {
        bits: u8, // 8 or 16
        members: Vec<(String, u64)>,
    },

    /// Tuple with elements
    Tuple(Vec<TupleElement>),

    /// Nested with elements
    Nested(Vec<TupleElement>),

    /// Map with key and value types
    Map {
        key_type: Box<ClickHouseTypeNode>,
        value_type: Box<ClickHouseTypeNode>,
    },

    /// Aggregate function
    AggregateFunction {
        function_name: String,
        argument_types: Vec<ClickHouseTypeNode>,
    },

    /// SimpleAggregateFunction
    SimpleAggregateFunction {
        function_name: String,
        argument_type: Box<ClickHouseTypeNode>,
    },
}

/// Represents an element in a Tuple or Nested type
#[derive(Debug, Clone, PartialEq)]
pub enum TupleElement {
    /// Named element (name Type)
    Named {
        name: String,
        type_node: ClickHouseTypeNode,
    },
    /// Unnamed element (just Type)
    Unnamed(ClickHouseTypeNode),
}

impl fmt::Display for ClickHouseTypeNode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClickHouseTypeNode::Simple(name) => write!(f, "{name}"),
            ClickHouseTypeNode::Nullable(inner) => write!(f, "Nullable({inner})"),
            ClickHouseTypeNode::Array(inner) => write!(f, "Array({inner})"),
            ClickHouseTypeNode::LowCardinality(inner) => write!(f, "LowCardinality({inner})"),
            ClickHouseTypeNode::Decimal { precision, scale } => {
                write!(f, "Decimal({precision}, {scale})")
            }
            ClickHouseTypeNode::DecimalSized { bits, precision } => {
                write!(f, "Decimal{bits}({precision})")
            }
            ClickHouseTypeNode::DateTime { timezone } => match timezone {
                Some(tz) => write!(f, "DateTime('{tz}')"),
                None => write!(f, "DateTime"),
            },
            ClickHouseTypeNode::DateTime64 {
                precision,
                timezone,
            } => match timezone {
                Some(tz) => write!(f, "DateTime64({precision}, '{tz}')"),
                None => write!(f, "DateTime64({precision})"),
            },
            ClickHouseTypeNode::FixedString(length) => write!(f, "FixedString({length})"),
            ClickHouseTypeNode::Nothing => write!(f, "Nothing"),
            ClickHouseTypeNode::BFloat16 => write!(f, "BFloat16"),
            ClickHouseTypeNode::IPv4 => write!(f, "IPv4"),
            ClickHouseTypeNode::IPv6 => write!(f, "IPv6"),
            ClickHouseTypeNode::JSON => write!(f, "JSON"),
            ClickHouseTypeNode::Dynamic => write!(f, "Dynamic"),
            ClickHouseTypeNode::Object(params) => match params {
                Some(p) => write!(f, "Object({p})"),
                None => write!(f, "Object"),
            },
            ClickHouseTypeNode::Variant(types) => {
                write!(f, "Variant(")?;
                for (i, t) in types.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "{t}")?;
                }
                write!(f, ")")
            }
            ClickHouseTypeNode::Interval(interval_type) => write!(f, "Interval{interval_type}"),
            ClickHouseTypeNode::Geo(geo_type) => write!(f, "{geo_type}"),
            ClickHouseTypeNode::Enum { bits, members } => {
                write!(f, "Enum{bits}(")?;
                for (i, (name, value)) in members.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    write!(f, "'{name}' = {value}")?;
                }
                write!(f, ")")
            }
            ClickHouseTypeNode::Tuple(elements) => {
                write!(f, "Tuple(")?;
                for (i, element) in elements.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    match element {
                        TupleElement::Named { name, type_node } => {
                            write!(f, "{name} {type_node}")?;
                        }
                        TupleElement::Unnamed(type_node) => {
                            write!(f, "{type_node}")?;
                        }
                    }
                }
                write!(f, ")")
            }
            ClickHouseTypeNode::Nested(elements) => {
                write!(f, "Nested(")?;
                for (i, element) in elements.iter().enumerate() {
                    if i > 0 {
                        write!(f, ", ")?;
                    }
                    match element {
                        TupleElement::Named { name, type_node } => {
                            write!(f, "{name} {type_node}")?;
                        }
                        TupleElement::Unnamed(_) => {
                            // Nested elements should always be named
                            write!(f, "[invalid unnamed element]")?;
                        }
                    }
                }
                write!(f, ")")
            }
            ClickHouseTypeNode::Map {
                key_type,
                value_type,
            } => {
                write!(f, "Map({key_type}, {value_type})")
            }
            ClickHouseTypeNode::AggregateFunction {
                function_name,
                argument_types,
            } => {
                write!(f, "AggregateFunction({function_name}")?;
                for arg_type in argument_types {
                    write!(f, ", {arg_type}")?;
                }
                write!(f, ")")
            }
            ClickHouseTypeNode::SimpleAggregateFunction {
                function_name,
                argument_type,
            } => {
                write!(
                    f,
                    "SimpleAggregateFunction({function_name}, {argument_type})"
                )
            }
        }
    }
}

// =========================================================
// Lexer / Tokenizer using Logos
// =========================================================

/// Tokenizes a ClickHouse type string into a sequence of tokens
fn tokenize(input: &str) -> Result<Vec<Token>, TokenizerError> {
    let mut lexer = Token::lexer(input);
    let mut tokens = Vec::new();

    while let Some(token_result) = lexer.next() {
        match token_result {
            Ok(token) => tokens.push(token),
            Err(_) => {
                return Err(TokenizerError::LexerError {
                    position: lexer.span().start,
                });
            }
        }
    }

    // Add explicit EOF token
    tokens.push(Token::Eof);

    Ok(tokens)
}

// Test for unterminated string
fn check_unterminated_string(input: &str) -> Result<(), TokenizerError> {
    // Simple check for unterminated string literals
    let mut in_string = false;
    let mut string_start = 0;
    let mut escape = false;
    let mut quote_char = ' ';

    for (i, c) in input.chars().enumerate() {
        if !in_string {
            if c == '\'' || c == '"' {
                in_string = true;
                string_start = i;
                quote_char = c;
            }
        } else if escape {
            escape = false;
        } else if c == '\\' {
            escape = true;
        } else if c == quote_char {
            in_string = false;
        }
    }

    if in_string {
        Err(TokenizerError::UnterminatedString {
            position: string_start,
        })
    } else {
        Ok(())
    }
}

// =========================================================
// Parser
// =========================================================

/// Parser for ClickHouse type expressions
struct Parser {
    tokens: Vec<Token>,
    current_pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Token>) -> Self {
        Self {
            tokens,
            current_pos: 0,
        }
    }

    fn current_token(&self) -> &Token {
        if self.current_pos < self.tokens.len() {
            &self.tokens[self.current_pos]
        } else {
            // The last token should always be Eof
            &self.tokens[self.tokens.len() - 1]
        }
    }

    fn consume(&mut self, expected: &Token) -> Result<(), ParseError> {
        let current = self.current_token();

        // Check if the tokens have the same discriminant
        if std::mem::discriminant(current) != std::mem::discriminant(expected) {
            return Err(ParseError::UnexpectedToken {
                expected: self.token_to_string(expected),
                found: self.token_to_string(current),
            });
        }

        self.advance();
        Ok(())
    }

    fn token_to_string(&self, token: &Token) -> String {
        match token {
            Token::Identifier(s) => format!("identifier '{s}'"),
            Token::StringLiteral(s) => format!("string '{s}'"),
            Token::NumberLiteral(n) => format!("number {n}"),
            Token::LeftParen => "(".to_string(),
            Token::RightParen => ")".to_string(),
            Token::Comma => ",".to_string(),
            Token::Equals => "=".to_string(),
            Token::Error => "error".to_string(),
            Token::Eof => "end of input".to_string(),
        }
    }

    fn advance(&mut self) {
        if self.current_pos < self.tokens.len() - 1 {
            self.current_pos += 1;
        }
    }

    pub fn parse(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        let type_node = self.parse_type()?;
        self.consume(&Token::Eof)?;
        Ok(type_node)
    }

    fn parse_type(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        match self.current_token() {
            Token::Identifier(name) => {
                let name_clone = name.clone();
                self.advance();

                match name_clone.as_str() {
                    "Nullable" => self.parse_nullable(),
                    "Array" => self.parse_array(),
                    "LowCardinality" => self.parse_low_cardinality(),
                    "Decimal" => self.parse_decimal(),
                    "DateTime" => self.parse_datetime(),
                    "DateTime64" => self.parse_datetime64(),
                    "FixedString" => self.parse_fixed_string(),
                    "Tuple" => self.parse_tuple(),
                    "Nested" => self.parse_nested(),
                    "Map" => self.parse_map(),
                    "AggregateFunction" => self.parse_aggregate_function(),
                    "SimpleAggregateFunction" => self.parse_simple_aggregate_function(),
                    "Variant" => self.parse_variant(),
                    "Object" => self.parse_object(),
                    // Simple types with no parameters
                    "Nothing" => Ok(ClickHouseTypeNode::Nothing),
                    "BFloat16" => Ok(ClickHouseTypeNode::BFloat16),
                    "IPv4" => Ok(ClickHouseTypeNode::IPv4),
                    "IPv6" => Ok(ClickHouseTypeNode::IPv6),
                    "JSON" => Ok(ClickHouseTypeNode::JSON),
                    "Dynamic" => Ok(ClickHouseTypeNode::Dynamic),
                    // Check for Interval types
                    name if name.starts_with("Interval") => {
                        let interval_type = name.strip_prefix("Interval").unwrap_or("");
                        Ok(ClickHouseTypeNode::Interval(interval_type.to_string()))
                    }
                    // Check for Geo types
                    name if matches!(
                        name,
                        "Point"
                            | "Ring"
                            | "Polygon"
                            | "MultiPolygon"
                            | "LineString"
                            | "MultiLineString"
                    ) =>
                    {
                        Ok(ClickHouseTypeNode::Geo(name.to_string()))
                    }
                    // Check for specialized Decimal types
                    name if name.starts_with("Decimal") => self.parse_decimal_sized(&name_clone),
                    // Check for Enum types
                    name if name.starts_with("Enum") => self.parse_enum(&name_clone),
                    // Default to simple type
                    name => Ok(ClickHouseTypeNode::Simple(name.to_string())),
                }
            }
            _ => Err(ParseError::UnexpectedToken {
                expected: "type name".to_string(),
                found: self.token_to_string(self.current_token()),
            }),
        }
    }

    fn parse_nullable(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;
        let inner_type = self.parse_type()?;
        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Nullable(Box::new(inner_type)))
    }

    fn parse_array(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;
        let inner_type = self.parse_type()?;
        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Array(Box::new(inner_type)))
    }

    fn parse_low_cardinality(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;
        let inner_type = self.parse_type()?;
        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::LowCardinality(Box::new(inner_type)))
    }

    fn parse_decimal(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse precision
        let precision = match self.current_token() {
            Token::NumberLiteral(n) => *n as u8,
            _ => {
                return Err(ParseError::MissingParameter {
                    type_name: "Decimal".to_string(),
                    message: "number literal for precision".to_string(),
                });
            }
        };
        self.advance();

        // Parse comma
        self.consume(&Token::Comma)?;

        // Parse scale
        let scale = match self.current_token() {
            Token::NumberLiteral(n) => *n as u8,
            _ => {
                return Err(ParseError::MissingParameter {
                    type_name: "Decimal".to_string(),
                    message: "number literal for scale".to_string(),
                });
            }
        };
        self.advance();

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Decimal { precision, scale })
    }

    fn parse_decimal_sized(&mut self, type_name: &str) -> Result<ClickHouseTypeNode, ParseError> {
        // Extract bits from type name
        let bits = match type_name {
            "Decimal32" => 32,
            "Decimal64" => 64,
            "Decimal128" => 128,
            "Decimal256" => 256,
            _ => {
                return Err(ParseError::SyntaxError {
                    message: format!("Invalid decimal type name: {type_name}"),
                });
            }
        };

        self.consume(&Token::LeftParen)?;

        // Parse precision
        let precision = match self.current_token() {
            Token::NumberLiteral(n) => *n as u8,
            _ => {
                return Err(ParseError::MissingParameter {
                    type_name: type_name.to_string(),
                    message: "number literal for precision".to_string(),
                });
            }
        };

        self.advance();
        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::DecimalSized {
            bits: bits as u16,
            precision,
        })
    }

    fn parse_datetime(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        // Check if there are parameters (timezone)
        if matches!(self.current_token(), Token::LeftParen) {
            self.consume(&Token::LeftParen)?;

            // Parse timezone string
            let timezone = match self.current_token() {
                Token::StringLiteral(tz) => {
                    let tz_str = tz.clone();
                    self.advance();
                    Some(tz_str)
                }
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "string literal for timezone".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            };

            self.consume(&Token::RightParen)?;

            Ok(ClickHouseTypeNode::DateTime { timezone })
        } else {
            // No parameters, just DateTime
            Ok(ClickHouseTypeNode::DateTime { timezone: None })
        }
    }

    fn parse_datetime64(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse precision
        let precision = match self.current_token() {
            Token::NumberLiteral(n) => *n as u8,
            _ => {
                return Err(ParseError::UnexpectedToken {
                    expected: "number literal for precision".to_string(),
                    found: format!("{:?}", self.current_token()),
                });
            }
        };
        self.advance();

        // Check for optional timezone
        let timezone = if matches!(self.current_token(), Token::Comma) {
            self.advance(); // Consume comma

            // Parse timezone string
            match self.current_token() {
                Token::StringLiteral(tz) => {
                    let tz_str = tz.clone();
                    self.advance();
                    Some(tz_str)
                }
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "string literal for timezone".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            }
        } else {
            None
        };

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::DateTime64 {
            precision,
            timezone,
        })
    }

    /// Parse a FixedString(N) type
    fn parse_fixed_string(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse length
        let length = match self.current_token() {
            Token::NumberLiteral(n) => *n,
            _ => {
                return Err(ParseError::UnexpectedToken {
                    expected: "number literal for length".to_string(),
                    found: format!("{:?}", self.current_token()),
                });
            }
        };
        self.advance();

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::FixedString(length))
    }

    /// Parse an Enum8/16('value' = number, ...) type
    fn parse_enum(&mut self, type_name: &str) -> Result<ClickHouseTypeNode, ParseError> {
        // Extract bits from type name
        let bits = match type_name {
            "Enum8" => 8,
            "Enum16" => 16,
            _ => {
                return Err(ParseError::SyntaxError {
                    message: format!("Invalid enum type name: {type_name}"),
                });
            }
        };

        self.consume(&Token::LeftParen)?;

        let mut members = Vec::new();
        loop {
            // Parse string literal
            let name = match self.current_token() {
                Token::StringLiteral(s) => s.clone(),
                Token::RightParen if members.is_empty() => {
                    // Empty enum, break early
                    break;
                }
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "string literal or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            };
            self.advance();

            // Parse equals sign
            self.consume(&Token::Equals)?;

            // Parse number
            let value = match self.current_token() {
                Token::NumberLiteral(n) => *n,
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "number literal for enum value".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            };
            self.advance();

            members.push((name, value));

            // Check for comma or end of list
            match self.current_token() {
                Token::Comma => {
                    self.advance();
                    continue;
                }
                Token::RightParen => break,
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "comma or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            }
        }

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Enum { bits, members })
    }

    /// Parse a Tuple(T1, T2, ...) or Tuple(name1 T1, name2 T2, ...) type
    fn parse_tuple(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        let mut elements = Vec::new();

        // Handle empty tuple case
        if matches!(self.current_token(), Token::RightParen) {
            self.advance();
            return Ok(ClickHouseTypeNode::Tuple(elements));
        }

        loop {
            // Try to parse a named tuple element first
            let element = match self.current_token() {
                Token::Identifier(name) => {
                    let element_name = name.clone();
                    self.advance();

                    // Check if next token is a type identifier
                    if matches!(self.current_token(), Token::Identifier(_)) {
                        // This is a named element
                        let type_node = self.parse_type()?;
                        TupleElement::Named {
                            name: element_name,
                            type_node,
                        }
                    } else {
                        // This is an unnamed element with the identifier as the type
                        self.current_pos -= 1; // Go back to re-parse the identifier as a type
                        let type_node = self.parse_type()?;
                        TupleElement::Unnamed(type_node)
                    }
                }
                _ => {
                    // This is an unnamed element
                    let type_node = self.parse_type()?;
                    TupleElement::Unnamed(type_node)
                }
            };

            elements.push(element);

            // Check for comma or end of list
            match self.current_token() {
                Token::Comma => {
                    self.advance();
                    continue;
                }
                Token::RightParen => break,
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "comma or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            }
        }

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Tuple(elements))
    }

    /// Parse a Nested(name1 T1, name2 T2, ...) type
    fn parse_nested(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        let mut elements = Vec::new();

        // Handle empty nested case
        if matches!(self.current_token(), Token::RightParen) {
            self.advance();
            return Ok(ClickHouseTypeNode::Nested(elements));
        }

        loop {
            // Nested type requires named elements
            let element = match self.current_token() {
                Token::Identifier(name) => {
                    let element_name = name.clone();
                    self.advance();

                    // Parse the type
                    let type_node = self.parse_type()?;
                    TupleElement::Named {
                        name: element_name,
                        type_node,
                    }
                }
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "identifier for column name".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            };

            elements.push(element);

            // Check for comma or end of list
            match self.current_token() {
                Token::Comma => {
                    self.advance();
                    continue;
                }
                Token::RightParen => break,
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "comma or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            }
        }

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Nested(elements))
    }

    /// Parse a Map(K, V) type
    fn parse_map(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse key type
        let key_type = self.parse_type()?;

        // Parse comma
        self.consume(&Token::Comma)?;

        // Parse value type
        let value_type = self.parse_type()?;

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::Map {
            key_type: Box::new(key_type),
            value_type: Box::new(value_type),
        })
    }

    /// Parse an AggregateFunction(name, T1, T2, ...) type
    fn parse_aggregate_function(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse function name
        let function_name = match self.current_token() {
            Token::Identifier(name) => name.clone(),
            _ => {
                return Err(ParseError::UnexpectedToken {
                    expected: "identifier for function name".to_string(),
                    found: format!("{:?}", self.current_token()),
                });
            }
        };
        self.advance();

        let mut argument_types = Vec::new();

        // Check if there are any arguments
        if matches!(self.current_token(), Token::Comma) {
            loop {
                self.consume(&Token::Comma)?;

                // Parse argument type
                let arg_type = self.parse_type()?;
                argument_types.push(arg_type);

                // Check if there are more arguments
                if !matches!(self.current_token(), Token::Comma) {
                    break;
                }
            }
        }

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::AggregateFunction {
            function_name,
            argument_types,
        })
    }

    /// Parse a SimpleAggregateFunction(name, T) type
    fn parse_simple_aggregate_function(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        // Parse function name
        let function_name = match self.current_token() {
            Token::Identifier(name) => name.clone(),
            _ => {
                return Err(ParseError::UnexpectedToken {
                    expected: "identifier for function name".to_string(),
                    found: format!("{:?}", self.current_token()),
                });
            }
        };
        self.advance();

        // Parse comma
        self.consume(&Token::Comma)?;

        // Parse argument type
        let argument_type = self.parse_type()?;

        self.consume(&Token::RightParen)?;

        Ok(ClickHouseTypeNode::SimpleAggregateFunction {
            function_name,
            argument_type: Box::new(argument_type),
        })
    }

    /// Parse a Variant(T1, T2, ...) type
    fn parse_variant(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        self.consume(&Token::LeftParen)?;

        let mut types = Vec::new();

        // Handle empty variant case
        if matches!(self.current_token(), Token::RightParen) {
            self.advance();
            return Ok(ClickHouseTypeNode::Variant(types));
        }

        loop {
            // Parse type
            let type_node = self.parse_type()?;
            types.push(type_node);

            // Check for comma or end of list
            match self.current_token() {
                Token::Comma => {
                    self.advance();
                    continue;
                }
                Token::RightParen => break,
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "comma or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            }
        }

        self.consume(&Token::RightParen)?;
        Ok(ClickHouseTypeNode::Variant(types))
    }

    /// Parse an Object type with optional parameters
    fn parse_object(&mut self) -> Result<ClickHouseTypeNode, ParseError> {
        // Check if there are parameters
        if matches!(self.current_token(), Token::LeftParen) {
            self.consume(&Token::LeftParen)?;

            // Parse parameter string (could be a schema definition or other parameter)
            let params = match self.current_token() {
                Token::StringLiteral(s) => {
                    let s_clone = s.clone();
                    self.advance();
                    Some(s_clone)
                }
                Token::Identifier(s) => {
                    let s_clone = s.clone();
                    self.advance();
                    Some(s_clone)
                }
                Token::RightParen => {
                    self.advance();
                    None
                }
                _ => {
                    return Err(ParseError::UnexpectedToken {
                        expected: "string literal, identifier, or ')'".to_string(),
                        found: format!("{:?}", self.current_token()),
                    });
                }
            };

            if params.is_some() {
                self.consume(&Token::RightParen)?;
            }

            Ok(ClickHouseTypeNode::Object(params))
        } else {
            // No parameters, just Object
            Ok(ClickHouseTypeNode::Object(None))
        }
    }
}

// Parse a ClickHouse type string into an AST
pub fn parse_clickhouse_type(input: &str) -> Result<ClickHouseTypeNode, ParseError> {
    // First check for unterminated strings to maintain compatibility with error messages
    check_unterminated_string(input).map_err(ParseError::from)?;

    let tokens = tokenize(input).map_err(ParseError::from)?;
    let mut parser = Parser::new(tokens);
    parser.parse()
}

// =========================================================
// Conversion to Framework Types
// =========================================================

/// Convert a parsed ClickHouse type to the framework's ColumnType
pub fn convert_ast_to_column_type(
    node: &ClickHouseTypeNode,
) -> Result<(ColumnType, bool), ConversionError> {
    match node {
        ClickHouseTypeNode::Simple(name) => {
            let column_type = match name.as_str() {
                "String" => Ok(ColumnType::String),
                "Int8" => Ok(ColumnType::Int(IntType::Int8)),
                "Int16" => Ok(ColumnType::Int(IntType::Int16)),
                "Int32" => Ok(ColumnType::Int(IntType::Int32)),
                "Int64" => Ok(ColumnType::Int(IntType::Int64)),
                "Int128" => Ok(ColumnType::Int(IntType::Int128)),
                "Int256" => Ok(ColumnType::Int(IntType::Int256)),
                "UInt8" => Ok(ColumnType::Int(IntType::UInt8)),
                "UInt16" => Ok(ColumnType::Int(IntType::UInt16)),
                "UInt32" => Ok(ColumnType::Int(IntType::UInt32)),
                "UInt64" => Ok(ColumnType::Int(IntType::UInt64)),
                "UInt128" => Ok(ColumnType::Int(IntType::UInt128)),
                "UInt256" => Ok(ColumnType::Int(IntType::UInt256)),
                "Float32" => Ok(ColumnType::Float(FloatType::Float32)),
                "Float64" => Ok(ColumnType::Float(FloatType::Float64)),
                "Bool" | "Boolean" => Ok(ColumnType::Boolean),
                "JSON" => Ok(ColumnType::Json),
                "UUID" => Ok(ColumnType::Uuid),
                // ClickHouse Date (2 bytes) -> Framework Date16 (memory-optimized)
                "Date" => Ok(ColumnType::Date16),
                // ClickHouse Date32 (4 bytes) -> Framework Date (standard)
                "Date32" => Ok(ColumnType::Date),
                "IPv4" => Ok(ColumnType::IpV4),
                "IPv6" => Ok(ColumnType::IpV6),
                "DateTime" => Ok(ColumnType::DateTime { precision: None }),
                _ => Err(ConversionError::UnsupportedType {
                    type_name: name.clone(),
                }),
            }?;

            Ok((column_type, false))
        }

        ClickHouseTypeNode::Nullable(inner) => {
            let (inner_type, _) = convert_ast_to_column_type(inner)?;
            Ok((inner_type, true))
        }

        ClickHouseTypeNode::Array(inner) => {
            let (inner_type, is_nullable) = convert_ast_to_column_type(inner)?;
            Ok((
                ColumnType::Array {
                    element_type: Box::new(inner_type),
                    element_nullable: is_nullable,
                },
                false,
            ))
        }

        ClickHouseTypeNode::LowCardinality(inner) => {
            // LowCardinality is an optimization hint in ClickHouse,
            // we just use the inner type in our framework
            convert_ast_to_column_type(inner)
        }

        ClickHouseTypeNode::Decimal { precision, scale } => Ok((
            ColumnType::Decimal {
                precision: *precision,
                scale: *scale,
            },
            false,
        )),

        ClickHouseTypeNode::DecimalSized { bits, precision } => {
            // Make sure the precision is valid for the bit size
            let max_precision = match *bits {
                32 => 9,
                64 => 18,
                128 => 38,
                256 => 76,
                _ => {
                    return Err(ConversionError::InvalidParameters {
                        type_name: format!("Decimal{bits}"),
                        message: format!("Invalid bit size: {bits}"),
                    });
                }
            };

            if *precision > max_precision {
                return Err(ConversionError::InvalidParameters {
                    type_name: format!("Decimal{bits}"),
                    message: format!(
                        "Precision {precision} exceeds maximum {max_precision} for Decimal{bits}"
                    ),
                });
            }

            // We only track precision and scale in our type system
            Ok((
                ColumnType::Decimal {
                    precision: *precision,
                    scale: 0, // Default scale for DecimalN types
                },
                false,
            ))
        }

        ClickHouseTypeNode::DateTime { timezone: _ } => {
            // We don't currently track timezone in our framework type system
            Ok((ColumnType::DateTime { precision: None }, false))
        }

        ClickHouseTypeNode::DateTime64 {
            precision,
            timezone: _,
        } => {
            // We don't currently track timezone in our framework type system
            Ok((
                ColumnType::DateTime {
                    precision: Some(*precision),
                },
                false,
            ))
        }

        ClickHouseTypeNode::FixedString(_) => {
            // FixedString is mapped to regular String in our type system
            Ok((ColumnType::String, false))
        }

        ClickHouseTypeNode::Nothing => Err(ConversionError::UnsupportedType {
            type_name: "Nothing".to_string(),
        }),

        ClickHouseTypeNode::BFloat16 => Err(ConversionError::UnsupportedType {
            type_name: "BFloat16".to_string(),
        }),

        ClickHouseTypeNode::IPv4 => Ok((ColumnType::IpV4, false)),
        ClickHouseTypeNode::IPv6 => Ok((ColumnType::IpV6, false)),

        ClickHouseTypeNode::JSON => Ok((ColumnType::Json, false)),

        ClickHouseTypeNode::Dynamic => Err(ConversionError::UnsupportedType {
            type_name: "Dynamic".to_string(),
        }),

        ClickHouseTypeNode::Object(_) => Err(ConversionError::UnsupportedType {
            type_name: "Object".to_string(),
        }),

        ClickHouseTypeNode::Variant(_) => Err(ConversionError::UnsupportedType {
            type_name: "Variant".to_string(),
        }),

        ClickHouseTypeNode::Interval(interval_type) => Err(ConversionError::UnsupportedType {
            type_name: format!("Interval{interval_type}"),
        }),

        ClickHouseTypeNode::Geo(geo_type) => Err(ConversionError::UnsupportedType {
            type_name: geo_type.clone(),
        }),

        ClickHouseTypeNode::Enum { bits, members } => {
            let enum_members = members
                .iter()
                .map(|(name, value)| EnumMember {
                    name: name.clone(),
                    value: EnumValue::Int(*value as u8),
                })
                .collect::<Vec<_>>();

            Ok((
                ColumnType::Enum(DataEnum {
                    name: format!("Enum{bits}"),
                    values: enum_members,
                }),
                false,
            ))
        }

        ClickHouseTypeNode::Nested(elements) => {
            let mut columns = Vec::new();

            for element in elements {
                match element {
                    TupleElement::Named { name, type_node } => {
                        let (data_type, is_nullable) = convert_ast_to_column_type(type_node)?;

                        columns.push(Column {
                            name: name.clone(),
                            data_type,
                            required: !is_nullable,
                            unique: false,
                            primary_key: false,
                            default: None,
                            annotations: Vec::new(),
                            // Comment is None here because we're parsing type strings only.
                            // Actual column comments (including enum metadata) come from
                            // system.columns queries, not from type string parsing.
                            comment: None,
                        });
                    }
                    TupleElement::Unnamed(_) => {
                        return Err(ConversionError::InvalidParameters {
                            type_name: "Nested".to_string(),
                            message: "Unnamed elements not allowed in Nested type".to_string(),
                        });
                    }
                }
            }

            // Generate a name based on content if there are columns
            let nested_name = if !columns.is_empty() {
                format!("nested_{}", columns.len())
            } else {
                "nested".to_string()
            };

            Ok((
                ColumnType::Nested(Nested {
                    name: nested_name,
                    columns,
                    jwt: false,
                }),
                false,
            ))
        }

        ClickHouseTypeNode::Tuple(elements) => {
            let mut fields = Vec::new();
            for element in elements.iter() {
                match element {
                    TupleElement::Named { name, type_node } => {
                        let (field_type, _) = convert_ast_to_column_type(type_node)?;
                        fields.push((name.clone(), field_type));
                    }
                    TupleElement::Unnamed(_) => {
                        return Err(ConversionError::UnsupportedType {
                            type_name: "Unnamed tuple".to_string(),
                        });
                    }
                }
            }
            Ok((ColumnType::NamedTuple(fields), false))
        }

        ClickHouseTypeNode::Map {
            key_type,
            value_type,
        } => {
            let (key_column_type, _) = convert_ast_to_column_type(key_type)?;
            let (value_column_type, _) = convert_ast_to_column_type(value_type)?;
            Ok((
                ColumnType::Map {
                    key_type: Box::new(key_column_type),
                    value_type: Box::new(value_column_type),
                },
                false,
            ))
        }

        ClickHouseTypeNode::AggregateFunction { .. } => {
            // AggregateFunction is specialized, and we don't have a direct mapping.
            // These are typically used in materialized views, not in regular tables.
            Err(ConversionError::UnsupportedType {
                type_name: "AggregateFunction".to_string(),
            })
        }

        ClickHouseTypeNode::SimpleAggregateFunction { .. } => {
            // Same as AggregateFunction
            Err(ConversionError::UnsupportedType {
                type_name: "SimpleAggregateFunction".to_string(),
            })
        }
    }
}

/// Converts a ClickHouse type string to the framework's ColumnType
///
/// # Arguments
/// * `ch_type` - The ClickHouse type string to convert
///
/// # Returns
/// * `Result<(ColumnType, bool), ClickHouseTypeError>` - A tuple containing:
///   - The converted framework type
///   - A boolean indicating if the type is nullable (true = nullable)
pub fn convert_clickhouse_type_to_column_type(
    ch_type: &str,
) -> Result<(ColumnType, bool), ClickHouseTypeError> {
    // Parse the ClickHouse type string into an AST
    let type_node = parse_clickhouse_type(ch_type).map_err(|e| ClickHouseTypeError::Parse {
        input: ch_type.to_string(),
        source: e,
    })?;

    // Convert the AST to a framework type
    convert_ast_to_column_type(&type_node)
        .map_err(|e| ClickHouseTypeError::Conversion { source: e })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::framework::core::infrastructure::table::IntType::UInt32;

    #[test]
    fn test_tokenizer() {
        let input = "Nullable(Array(String))";
        let tokens = tokenize(input).unwrap();

        // Compare token types and values individually
        assert!(tokens.len() >= 7);
        assert!(matches!(tokens[0], Token::Identifier(ref s) if s == "Nullable"));
        assert!(matches!(tokens[1], Token::LeftParen));
        assert!(matches!(tokens[2], Token::Identifier(ref s) if s == "Array"));
        assert!(matches!(tokens[3], Token::LeftParen));
        assert!(matches!(tokens[4], Token::Identifier(ref s) if s == "String"));
        assert!(matches!(tokens[5], Token::RightParen));
        assert!(matches!(tokens[6], Token::RightParen));
    }

    #[test]
    fn test_parse_simple_types() {
        let types = vec![
            "String", "Int32", "UInt64", "Float32", "Boolean", "UUID", "Date32",
        ];

        for type_str in types {
            let result = parse_clickhouse_type(type_str);
            assert!(result.is_ok(), "Failed to parse {type_str}: {result:?}");
            assert_eq!(
                result.unwrap(),
                ClickHouseTypeNode::Simple(type_str.to_string())
            );
        }

        // Test DateTime specially since it's now a separate type
        let result = parse_clickhouse_type("DateTime");
        assert!(result.is_ok(), "Failed to parse DateTime: {result:?}");
        assert_eq!(
            result.unwrap(),
            ClickHouseTypeNode::DateTime { timezone: None }
        );
    }

    #[test]
    fn test_parse_nullable() {
        let result = parse_clickhouse_type("Nullable(String)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Nullable(Box::new(ClickHouseTypeNode::Simple(
                "String".to_string()
            )))
        );
    }

    #[test]
    fn test_parse_array() {
        let result = parse_clickhouse_type("Array(Int32)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Array(Box::new(ClickHouseTypeNode::Simple("Int32".to_string())))
        );
    }

    #[test]
    fn test_parse_nested_types() {
        let result = parse_clickhouse_type("Nullable(Array(String))").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Nullable(Box::new(ClickHouseTypeNode::Array(Box::new(
                ClickHouseTypeNode::Simple("String".to_string())
            ))))
        );
    }

    #[test]
    fn test_parse_decimal() {
        let result = parse_clickhouse_type("Decimal(10, 2)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Decimal {
                precision: 10,
                scale: 2,
            }
        );
    }

    #[test]
    fn test_parse_decimal_sized() {
        let result = parse_clickhouse_type("Decimal64(10)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::DecimalSized {
                bits: 64,
                precision: 10,
            }
        );
    }

    #[test]
    fn test_parse_datetime() {
        // Test without timezone
        let result = parse_clickhouse_type("DateTime").unwrap();
        assert_eq!(result, ClickHouseTypeNode::DateTime { timezone: None });

        // Test with timezone
        let result = parse_clickhouse_type("DateTime('UTC')").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::DateTime {
                timezone: Some("UTC".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_fixed_string() {
        let result = parse_clickhouse_type("FixedString(16)").unwrap();
        assert_eq!(result, ClickHouseTypeNode::FixedString(16));
    }

    #[test]
    fn test_parse_enum() {
        let result = parse_clickhouse_type("Enum8('red' = 1, 'green' = 2, 'blue' = 3)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Enum {
                bits: 8,
                members: vec![
                    ("red".to_string(), 1),
                    ("green".to_string(), 2),
                    ("blue".to_string(), 3),
                ],
            }
        );
    }

    #[test]
    fn test_parse_tuple() {
        // Test unnamed tuple
        let result = parse_clickhouse_type("Tuple(String, Int32)").unwrap();
        match result {
            ClickHouseTypeNode::Tuple(elements) => {
                assert_eq!(elements.len(), 2);
                assert!(matches!(elements[0], TupleElement::Unnamed(_)));
                assert!(matches!(elements[1], TupleElement::Unnamed(_)));
            }
            _ => panic!("Expected Tuple type"),
        }

        // Test named tuple
        let result = parse_clickhouse_type("Tuple(name String, id Int32)").unwrap();
        match result {
            ClickHouseTypeNode::Tuple(elements) => {
                assert_eq!(elements.len(), 2);
                assert!(matches!(elements[0], TupleElement::Named { .. }));
                assert!(matches!(elements[1], TupleElement::Named { .. }));

                if let TupleElement::Named { name, .. } = &elements[0] {
                    assert_eq!(name, "name");
                }
                if let TupleElement::Named { name, .. } = &elements[1] {
                    assert_eq!(name, "id");
                }
            }
            _ => panic!("Expected Tuple type"),
        }
    }

    #[test]
    fn test_parse_nested() {
        let result = parse_clickhouse_type("Nested(name String, id UInt32)").unwrap();
        match result {
            ClickHouseTypeNode::Nested(elements) => {
                assert_eq!(elements.len(), 2);
                assert!(matches!(elements[0], TupleElement::Named { .. }));
                assert!(matches!(elements[1], TupleElement::Named { .. }));

                if let TupleElement::Named { name, type_node } = &elements[0] {
                    assert_eq!(name, "name");
                    assert_eq!(*type_node, ClickHouseTypeNode::Simple("String".to_string()));
                }
                if let TupleElement::Named { name, type_node } = &elements[1] {
                    assert_eq!(name, "id");
                    assert_eq!(*type_node, ClickHouseTypeNode::Simple("UInt32".to_string()));
                }
            }
            _ => panic!("Expected Nested type"),
        }
    }

    #[test]
    fn test_parse_map() {
        let result = parse_clickhouse_type("Map(String, Int32)").unwrap();
        match result {
            ClickHouseTypeNode::Map {
                key_type,
                value_type,
            } => {
                assert_eq!(*key_type, ClickHouseTypeNode::Simple("String".to_string()));
                assert_eq!(*value_type, ClickHouseTypeNode::Simple("Int32".to_string()));
            }
            _ => panic!("Expected Map type"),
        }
    }

    #[test]
    fn test_parse_aggregate_function() {
        let result = parse_clickhouse_type("AggregateFunction(sum, Int32)").unwrap();
        match result {
            ClickHouseTypeNode::AggregateFunction {
                function_name,
                argument_types,
            } => {
                assert_eq!(function_name, "sum");
                assert_eq!(argument_types.len(), 1);
                assert_eq!(
                    argument_types[0],
                    ClickHouseTypeNode::Simple("Int32".to_string())
                );
            }
            _ => panic!("Expected AggregateFunction type"),
        }
    }

    #[test]
    fn test_complex_types() {
        // Test an extremely complex type
        let complex_type =
            "Array(Nullable(Map(String, Tuple(x UInt32, y Array(Nullable(String))))))";
        let result = parse_clickhouse_type(complex_type);
        assert!(result.is_ok(), "Failed to parse complex type: {result:?}");

        // Test serialization/deserialization idempotence
        let node = result.unwrap();
        let serialized = node.to_string();
        let reparsed = parse_clickhouse_type(&serialized);
        assert!(
            reparsed.is_ok(),
            "Failed to reparse serialized type: {reparsed:?}"
        );

        assert_eq!(
            convert_ast_to_column_type(&node).unwrap(),
            (
                ColumnType::Array {
                    element_type: Box::new(ColumnType::Map {
                        key_type: Box::new(ColumnType::String),
                        value_type: Box::new(ColumnType::NamedTuple(vec![
                            ("x".to_string(), ColumnType::Int(UInt32)),
                            (
                                "y".to_string(),
                                ColumnType::Array {
                                    element_type: Box::new(ColumnType::String),
                                    element_nullable: true,
                                }
                            )
                        ]))
                    }),
                    element_nullable: true,
                },
                false
            )
        );
    }

    #[test]
    fn test_tuple_types() {
        // Test that Tuple type conversion fails
        let tuple_type = parse_clickhouse_type("Tuple(String, Int32)").unwrap();
        let tuple_result = convert_ast_to_column_type(&tuple_type);
        if let Err(ConversionError::UnsupportedType { type_name }) = tuple_result {
            assert_eq!(type_name, "Unnamed tuple");
        } else {
            panic!("Expected UnsupportedType error for Tuple");
        }

        // Test the full conversion function with the top level ClickHouseTypeError
        let result = convert_clickhouse_type_to_column_type("Tuple(String, Int32)");
        assert!(result.is_err(), "Tuple type should not be convertible");

        // Check the proper error layering
        if let Err(ClickHouseTypeError::Conversion { source }) = result {
            if let ConversionError::UnsupportedType { type_name } = source {
                assert_eq!(type_name, "Unnamed tuple");
            } else {
                panic!("Expected UnsupportedType error for Tuple");
            }
        } else {
            panic!("Expected Conversion error with UnsupportedType source");
        }

        // Test unsupported type conversion
        let tuple_type = parse_clickhouse_type("Tuple(Int32, String)").unwrap();
        let tuple_conversion = convert_ast_to_column_type(&tuple_type);
        assert!(
            tuple_conversion.is_err(),
            "Tuple type should not be convertible"
        );

        match tuple_conversion {
            Err(ConversionError::UnsupportedType { type_name }) => {
                assert_eq!(type_name, "Unnamed tuple");
            }
            _ => panic!("Expected ConversionError::UnsupportedType"),
        }

        let tuple_type = parse_clickhouse_type("Tuple(i Int32, s String)").unwrap();
        let tuple_conversion = convert_ast_to_column_type(&tuple_type);
        assert!(
            tuple_conversion.is_ok(),
            "Tuple type should be convertible to NamedTuple"
        );

        match tuple_conversion.unwrap() {
            (ColumnType::NamedTuple(fields), false) => {
                assert_eq!(fields.len(), 2);
                assert_eq!(fields[0].0, "i");
                assert_eq!(fields[0].1, ColumnType::Int(IntType::Int32));
                assert_eq!(fields[1].0, "s");
                assert_eq!(fields[1].1, ColumnType::String);
            }
            _ => panic!("Expected NamedTuple type"),
        }
    }

    #[test]
    fn test_convert_unsupported_types() {
        // Test that AggregateFunction type conversion fails
        let agg_type = parse_clickhouse_type("AggregateFunction(sum, Int32)").unwrap();
        let agg_result = convert_ast_to_column_type(&agg_type);
        assert!(
            agg_result.is_err(),
            "AggregateFunction type should not be convertible"
        );

        if let Err(ConversionError::UnsupportedType { type_name }) = agg_result {
            assert_eq!(type_name, "AggregateFunction");
        } else {
            panic!("Expected UnsupportedType error for AggregateFunction");
        }

        // Test that SimpleAggregateFunction type conversion fails
        let simple_agg_type = parse_clickhouse_type("SimpleAggregateFunction(sum, Int32)").unwrap();
        let simple_agg_result = convert_ast_to_column_type(&simple_agg_type);
        assert!(
            simple_agg_result.is_err(),
            "SimpleAggregateFunction type should not be convertible"
        );

        if let Err(ConversionError::UnsupportedType { type_name }) = simple_agg_result {
            assert_eq!(type_name, "SimpleAggregateFunction");
        } else {
            panic!("Expected UnsupportedType error for SimpleAggregateFunction");
        }

        // Test the full conversion function with the top level ClickHouseTypeError
        let result = convert_clickhouse_type_to_column_type("AggregateFunction(sum, Int32)");
        assert!(
            result.is_err(),
            "AggregateFunction type should not be convertible"
        );

        // Check the proper error layering
        if let Err(ClickHouseTypeError::Conversion { source }) = result {
            if let ConversionError::UnsupportedType { type_name } = source {
                assert_eq!(type_name, "AggregateFunction");
            } else {
                panic!("Expected UnsupportedType error for AggregateFunction");
            }
        } else {
            panic!("Expected Conversion error with UnsupportedType source");
        }

        // Test parsing invalid syntax results in a Parse error
        let invalid_syntax_result = convert_clickhouse_type_to_column_type("NotValid(");
        assert!(invalid_syntax_result.is_err(), "Invalid syntax should fail");

        if let Err(ClickHouseTypeError::Parse { input, source: _ }) = invalid_syntax_result {
            assert_eq!(input, "NotValid(");
        } else {
            panic!("Expected Parse error for invalid syntax");
        }
    }

    #[test]
    fn test_idempotent_conversion() {
        // Ensure parsing and formatting is idempotent
        let test_types = vec![
            "String",
            "Nullable(String)",
            "Array(Int32)",
            "Array(Nullable(String))",
            "Decimal(10, 2)",
            "DateTime",
            "DateTime('UTC')",
            "DateTime64(3)",
            "DateTime64(3, 'UTC')",
            "Enum8('red' = 1, 'green' = 2, 'blue' = 3)",
            "Tuple(String, Int32)",
            "Tuple(name String, id UInt32)",
            "Nested(name String, id UInt32)",
            "Map(String, Int32)",
            "LowCardinality(String)",
        ];

        // Test types for parsing and string serialization idempotence
        for type_str in test_types {
            // Parse the type string
            let parsed = parse_clickhouse_type(type_str).unwrap();

            // Convert back to string
            let serialized = parsed.to_string();

            // Parse the serialized string
            let reparsed = parse_clickhouse_type(&serialized);

            // Compare the ASTs
            assert_eq!(parsed, reparsed.unwrap(), "Type not idempotent: {type_str}");
        }

        // Test types for conversion to framework types (only those we support)
        let conversion_test_types = vec![
            "String",
            "Nullable(String)",
            "Array(Int32)",
            "Array(Nullable(String))",
            "Decimal(10, 2)",
            "DateTime",
            "DateTime('UTC')",
            "DateTime64(3)",
            "DateTime64(3, 'UTC')",
            "Enum8('red' = 1, 'green' = 2, 'blue' = 3)",
            "Nested(name String, id UInt32)",
            "LowCardinality(String)",
        ];

        for type_str in conversion_test_types {
            let parsed = parse_clickhouse_type(type_str).unwrap();
            let conversion = convert_ast_to_column_type(&parsed);
            assert!(
                conversion.is_ok(),
                "Type {} should be convertible but got error: {:?}",
                type_str,
                conversion.err()
            );
        }
    }

    #[test]
    fn test_convert_to_column_type() {
        let types = vec![
            ("String", ColumnType::String, false),
            ("Int32", ColumnType::Int(IntType::Int32), false),
            ("UInt64", ColumnType::Int(IntType::UInt64), false),
            ("Float32", ColumnType::Float(FloatType::Float32), false),
            ("Boolean", ColumnType::Boolean, false),
            ("UUID", ColumnType::Uuid, false),
            ("Nullable(String)", ColumnType::String, true),
            ("Nullable(Int32)", ColumnType::Int(IntType::Int32), true),
        ];

        for (ch_type, expected_type, expected_nullable) in types {
            let (actual_type, actual_nullable) =
                convert_clickhouse_type_to_column_type(ch_type).unwrap();
            assert_eq!(actual_type, expected_type, "Failed on type {ch_type}");
            assert_eq!(
                actual_nullable, expected_nullable,
                "Failed on nullable {ch_type}"
            );
        }
    }

    #[test]
    fn test_convert_array_type() {
        // Test simple array
        let (array_type, is_nullable) =
            convert_clickhouse_type_to_column_type("Array(Int32)").unwrap();
        assert!(!is_nullable);
        match array_type {
            ColumnType::Array {
                element_type,
                element_nullable,
            } => {
                assert_eq!(*element_type, ColumnType::Int(IntType::Int32));
                assert!(!element_nullable);
            }
            _ => panic!("Expected Array type"),
        }

        // Test array of nullable elements
        let (array_type, is_nullable) =
            convert_clickhouse_type_to_column_type("Array(Nullable(String))").unwrap();
        assert!(!is_nullable);
        match array_type {
            ColumnType::Array {
                element_type,
                element_nullable,
            } => {
                assert_eq!(*element_type, ColumnType::String);
                assert!(element_nullable);
            }
            _ => panic!("Expected Array type"),
        }
    }

    #[test]
    fn test_convert_nested_type() {
        let ch_type = "Nested(col1 String, col2 Int32)";
        let (column_type, is_nullable) = convert_clickhouse_type_to_column_type(ch_type).unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::Nested(nested) => {
                assert_eq!(nested.columns.len(), 2);
                assert_eq!(nested.columns[0].name, "col1");
                assert_eq!(nested.columns[1].name, "col2");
                assert_eq!(nested.columns[0].data_type, ColumnType::String);
                assert_eq!(nested.columns[1].data_type, ColumnType::Int(IntType::Int32));
            }
            _ => panic!("Expected Nested type"),
        }
    }

    #[test]
    fn test_convert_complex_nested_type() {
        let ch_type = "Nested(name String, id UInt32, meta Nested(key String, value String))";
        let (column_type, is_nullable) = convert_clickhouse_type_to_column_type(ch_type).unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::Nested(nested) => {
                assert_eq!(nested.columns.len(), 3);
                assert_eq!(nested.columns[0].name, "name");
                assert_eq!(nested.columns[1].name, "id");
                assert_eq!(nested.columns[2].name, "meta");

                // Check the nested structure
                match &nested.columns[2].data_type {
                    ColumnType::Nested(inner_nested) => {
                        assert_eq!(inner_nested.columns.len(), 2);
                        assert_eq!(inner_nested.columns[0].name, "key");
                        assert_eq!(inner_nested.columns[1].name, "value");
                    }
                    _ => panic!("Expected Nested type for 'meta' column"),
                }
            }
            _ => panic!("Expected Nested type"),
        }
    }

    #[test]
    fn test_convert_enum_type() {
        let ch_type = "Enum8('RED' = 1, 'GREEN' = 2, 'BLUE' = 3)";
        let (column_type, is_nullable) = convert_clickhouse_type_to_column_type(ch_type).unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::Enum(data_enum) => {
                assert_eq!(data_enum.values.len(), 3);
                assert_eq!(data_enum.values[0].name, "RED");
                assert_eq!(data_enum.values[0].value, EnumValue::Int(1));
                assert_eq!(data_enum.values[1].name, "GREEN");
                assert_eq!(data_enum.values[1].value, EnumValue::Int(2));
                assert_eq!(data_enum.values[2].name, "BLUE");
                assert_eq!(data_enum.values[2].value, EnumValue::Int(3));
            }
            _ => panic!("Expected Enum type"),
        }
    }

    #[test]
    fn test_convert_decimal_type() {
        let (column_type, is_nullable) =
            convert_clickhouse_type_to_column_type("Decimal(10, 2)").unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::Decimal { precision, scale } => {
                assert_eq!(precision, 10);
                assert_eq!(scale, 2);
            }
            _ => panic!("Expected Decimal type"),
        }
    }

    #[test]
    fn test_convert_datetime_types() {
        // Test DateTime
        let (column_type, is_nullable) =
            convert_clickhouse_type_to_column_type("DateTime").unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::DateTime { precision } => {
                assert_eq!(precision, None);
            }
            _ => panic!("Expected DateTime type"),
        }

        // Test DateTime with timezone
        let (column_type, is_nullable) =
            convert_clickhouse_type_to_column_type("DateTime('UTC')").unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::DateTime { precision } => {
                assert_eq!(precision, None);
            }
            _ => panic!("Expected DateTime type"),
        }

        // Test DateTime64 with precision
        let (column_type, is_nullable) =
            convert_clickhouse_type_to_column_type("DateTime64(3)").unwrap();
        assert!(!is_nullable);
        match column_type {
            ColumnType::DateTime { precision } => {
                assert_eq!(precision, Some(3));
            }
            _ => panic!("Expected DateTime type"),
        }
    }

    // Add a new test for error handling specifically
    #[test]
    fn test_error_handling() {
        // Test tokenizer errors
        let unterminated_string = parse_clickhouse_type("Enum8('RED = 1");
        assert!(
            unterminated_string.is_err(),
            "Unterminated string should fail"
        );

        match unterminated_string {
            Err(ParseError::TokenizerError(TokenizerError::UnterminatedString { position })) => {
                assert_eq!(position, 6); // Position where the string starts
            }
            _ => panic!("Expected TokenizerError::UnterminatedString"),
        }

        // Test invalid Nested syntax - should fail during parsing
        let invalid_nested = parse_clickhouse_type("Nested(Int32)");
        assert!(invalid_nested.is_err(), "Invalid Nested format should fail");

        match invalid_nested {
            Err(ParseError::UnexpectedToken { expected, found }) => {
                assert_eq!(expected, "type name");
                assert_eq!(found, ")");
            }
            _ => panic!("Expected ParseError::UnexpectedToken"),
        }

        // Test valid named Nested type parsing and conversion
        let valid_nested = parse_clickhouse_type("Nested(col1 String)").unwrap();
        let nested_conversion = convert_ast_to_column_type(&valid_nested).unwrap();
        // Verify the conversion succeeds and produces the expected result
        match nested_conversion.0 {
            ColumnType::Nested(nested) => {
                assert_eq!(nested.columns.len(), 1);
                assert_eq!(nested.columns[0].name, "col1");
                assert_eq!(nested.columns[0].data_type, ColumnType::String);
            }
            _ => panic!("Expected Nested type"),
        }

        // Test unsupported type conversion
        let tuple_type = parse_clickhouse_type("Tuple(Int32, String)").unwrap();
        let tuple_conversion = convert_ast_to_column_type(&tuple_type);
        assert!(
            tuple_conversion.is_err(),
            "Tuple type should not be convertible"
        );

        match tuple_conversion {
            Err(ConversionError::UnsupportedType { type_name }) => {
                assert_eq!(type_name, "Unnamed tuple");
            }
            _ => panic!("Expected ConversionError::UnsupportedType"),
        }

        // Test unsupported type string
        let unsupported_type = convert_clickhouse_type_to_column_type("CustomType");
        assert!(unsupported_type.is_err(), "Unsupported type should fail");

        match unsupported_type {
            Err(ClickHouseTypeError::Conversion {
                source: ConversionError::UnsupportedType { type_name },
            }) => {
                assert_eq!(type_name, "CustomType");
            }
            _ => panic!("Expected ClickHouseTypeError::Conversion with UnsupportedType source"),
        }

        let tuple_type = parse_clickhouse_type("Tuple(Int32, String)").unwrap();
        let tuple_conversion = convert_ast_to_column_type(&tuple_type);
        match tuple_conversion {
            Err(ConversionError::UnsupportedType { type_name }) => {
                assert_eq!(type_name, "Unnamed tuple");
            }
            _ => panic!("Converting unnamed tuple should fail with UnsupportedType"),
        }
    }

    #[test]
    fn test_parse_datetime64() {
        // Test without timezone
        let result = parse_clickhouse_type("DateTime64(3)").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::DateTime64 {
                precision: 3,
                timezone: None,
            }
        );

        // Test with timezone
        let result = parse_clickhouse_type("DateTime64(3, 'UTC')").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::DateTime64 {
                precision: 3,
                timezone: Some("UTC".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_special_types() {
        // Test simple types with no parameters
        let simple_special_types = vec!["Nothing", "BFloat16", "IPv4", "IPv6", "JSON", "Dynamic"];

        for type_str in simple_special_types {
            let result = parse_clickhouse_type(type_str);
            assert!(result.is_ok(), "Failed to parse {type_str}: {result:?}");

            match type_str {
                "Nothing" => assert_eq!(result.unwrap(), ClickHouseTypeNode::Nothing),
                "BFloat16" => assert_eq!(result.unwrap(), ClickHouseTypeNode::BFloat16),
                "IPv4" => assert_eq!(result.unwrap(), ClickHouseTypeNode::IPv4),
                "IPv6" => assert_eq!(result.unwrap(), ClickHouseTypeNode::IPv6),
                "JSON" => assert_eq!(result.unwrap(), ClickHouseTypeNode::JSON),
                "Dynamic" => assert_eq!(result.unwrap(), ClickHouseTypeNode::Dynamic),
                _ => panic!("Unexpected type: {type_str}"),
            }
        }
    }

    #[test]
    fn test_parse_object_type() {
        // Test Object without parameters
        let result = parse_clickhouse_type("Object").unwrap();
        assert_eq!(result, ClickHouseTypeNode::Object(None));

        // Test Object with parameters
        let result = parse_clickhouse_type("Object('schema')").unwrap();
        assert_eq!(
            result,
            ClickHouseTypeNode::Object(Some("schema".to_string()))
        );
    }

    #[test]
    fn test_parse_variant_type() {
        // Test empty Variant
        let result = parse_clickhouse_type("Variant()").unwrap();
        assert_eq!(result, ClickHouseTypeNode::Variant(vec![]));

        // Test Variant with types
        let result = parse_clickhouse_type("Variant(String, Int32)").unwrap();
        match result {
            ClickHouseTypeNode::Variant(types) => {
                assert_eq!(types.len(), 2);
                assert_eq!(types[0], ClickHouseTypeNode::Simple("String".to_string()));
                assert_eq!(types[1], ClickHouseTypeNode::Simple("Int32".to_string()));
            }
            _ => panic!("Expected Variant type"),
        }
    }

    #[test]
    fn test_parse_interval_types() {
        let interval_types = vec![
            "IntervalYear",
            "IntervalQuarter",
            "IntervalMonth",
            "IntervalWeek",
            "IntervalDay",
            "IntervalHour",
            "IntervalMinute",
            "IntervalSecond",
            "IntervalMillisecond",
            "IntervalMicrosecond",
            "IntervalNanosecond",
        ];

        for type_str in interval_types {
            let result = parse_clickhouse_type(type_str);
            assert!(result.is_ok(), "Failed to parse {type_str}: {result:?}");

            let interval_suffix = type_str.strip_prefix("Interval").unwrap_or("");
            assert_eq!(
                result.unwrap(),
                ClickHouseTypeNode::Interval(interval_suffix.to_string())
            );
        }
    }

    #[test]
    fn test_parse_geo_types() {
        let geo_types = vec![
            "Point",
            "Ring",
            "Polygon",
            "MultiPolygon",
            "LineString",
            "MultiLineString",
        ];

        for type_str in geo_types {
            let result = parse_clickhouse_type(type_str);
            assert!(result.is_ok(), "Failed to parse {type_str}: {result:?}");

            assert_eq!(
                result.unwrap(),
                ClickHouseTypeNode::Geo(type_str.to_string())
            );
        }
    }

    #[test]
    fn test_conversion_not_supported_special_types() {
        // These special types are parsed but not supported in conversion
        let special_types = vec![
            "Nothing",
            "BFloat16",
            "Dynamic",
            "Object",
            "Object('schema')",
            "Variant(String, Int32)",
            "IntervalYear",
            "Point",
            "Polygon",
        ];

        for type_str in special_types {
            // Parse should succeed
            let parsed = parse_clickhouse_type(type_str).unwrap();

            // But conversion to framework type should fail with UnsupportedType
            let conversion = convert_ast_to_column_type(&parsed);
            assert!(
                conversion.is_err(),
                "Type {type_str} should not be convertible"
            );

            match &conversion {
                Err(ConversionError::UnsupportedType { type_name }) => {
                    println!("Correctly got UnsupportedType for {type_str}: {type_name}");
                }
                Err(e) => panic!("Expected UnsupportedType error for {type_str} but got: {e:?}"),
                Ok(_) => panic!("Expected error for {type_str}, but conversion succeeded"),
            }
        }

        // JSON should be supported
        let json_parsed = parse_clickhouse_type("JSON").unwrap();
        let json_conversion = convert_ast_to_column_type(&json_parsed);
        assert!(json_conversion.is_ok(), "JSON should be convertible");
        assert_eq!(json_conversion.unwrap().0, ColumnType::Json);
    }

    #[test]
    fn test_map_types() {
        // Test Map type parsing
        let map_type = parse_clickhouse_type("Map(String, Int32)").unwrap();
        let map_result = convert_ast_to_column_type(&map_type);
        assert!(map_result.is_ok(), "Map type should be convertible");

        match map_result.unwrap() {
            (
                ColumnType::Map {
                    key_type,
                    value_type,
                },
                false,
            ) => {
                assert_eq!(*key_type, ColumnType::String);
                assert_eq!(*value_type, ColumnType::Int(IntType::Int32));
            }
            _ => panic!("Expected Map type"),
        }

        // Test nested Map type
        let nested_map_type = parse_clickhouse_type("Map(String, Map(Int32, String))").unwrap();
        let nested_map_result = convert_ast_to_column_type(&nested_map_type);
        assert!(
            nested_map_result.is_ok(),
            "Nested Map type should be convertible"
        );

        match nested_map_result.unwrap() {
            (
                ColumnType::Map {
                    key_type,
                    value_type,
                },
                false,
            ) => {
                assert_eq!(*key_type, ColumnType::String);
                match value_type.as_ref() {
                    ColumnType::Map {
                        key_type: inner_key,
                        value_type: inner_value,
                    } => {
                        assert_eq!(**inner_key, ColumnType::Int(IntType::Int32));
                        assert_eq!(**inner_value, ColumnType::String);
                    }
                    _ => panic!("Expected nested Map type"),
                }
            }
            _ => panic!("Expected Map type"),
        }
    }
}
