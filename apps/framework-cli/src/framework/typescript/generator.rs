use convert_case::{Case, Casing};
use serde::Serialize;
use std::collections::HashSet;
use std::hash::Hash;
use std::{fmt, path::PathBuf};

use crate::framework::typescript;
use crate::{
    project::Project,
    utilities::{package_managers, system},
};

use super::templates::TypescriptRenderingError;
use crate::framework::core::infrastructure::table::{ColumnType, DataEnum, EnumValue, Table};

#[derive(Debug, thiserror::Error)]
#[error("Failed to generate Typescript code")]
#[non_exhaustive]
pub enum TypescriptGeneratorError {
    #[error("Typescript Code Generator - Unsupported data type: {type_name}")]
    UnsupportedDataTypeError {
        type_name: String,
    },
    FileWritingError(#[from] std::io::Error),
    RenderingError(#[from] typescript::templates::TypescriptRenderingError),
    ProjectFile(#[from] crate::project::ProjectFileError),
}

#[derive(Debug, Clone)]
pub struct TypescriptInterface {
    pub name: String,
    pub fields: Vec<InterfaceField>,
}

impl TypescriptInterface {
    pub fn new(name: String, fields: Vec<InterfaceField>) -> TypescriptInterface {
        TypescriptInterface { name, fields }
    }

    pub fn file_name(&self) -> String {
        //! Use when an interface is used in a file name. Does not include the .ts extension.
        self.name.to_case(Case::Pascal)
    }

    pub fn file_name_with_extension(&self) -> String {
        //! The interface's file name with the .ts extension.
        format!("{}.ts", self.file_name())
    }

    pub fn send_function_name(&self) -> String {
        format!("send{}", self.name.to_case(Case::Pascal))
    }

    pub fn send_function_file_name(&self) -> String {
        format!("Send{}", self.file_name())
    }

    pub fn send_function_file_name_with_extension(&self) -> String {
        format!("{}.ts", self.send_function_file_name())
    }

    pub fn var_name(&self) -> String {
        //! Use when an interface is used in a function, it is passed as a variable.
        self.name.to_case(Case::Camel)
    }

    pub fn create_code(&self) -> Result<String, TypescriptRenderingError> {
        typescript::templates::render_interface(self)
    }

    pub fn enums(&self) -> HashSet<String> {
        self.fields
            .iter()
            .filter_map(|field| {
                if let InterfaceFieldType::Enum(e) = &field.field_type {
                    Some(e.name.clone())
                } else {
                    None
                }
            })
            .collect()
    }
}

#[derive(Debug, Clone)]
pub struct InterfaceField {
    pub name: String,
    pub comment: Option<String>,
    pub is_optional: bool,
    pub field_type: InterfaceFieldType,
}

impl InterfaceField {
    pub fn new(
        name: String,
        comment: Option<String>,
        is_optional: bool,
        field_type: InterfaceFieldType,
    ) -> InterfaceField {
        InterfaceField {
            name,
            comment,
            is_optional,
            field_type,
        }
    }
}

#[derive(Debug, Clone)]
pub enum InterfaceFieldType {
    String,
    Null,
    Number,
    Boolean,
    Date,
    Array(Box<InterfaceFieldType>),
    Object(Box<TypescriptInterface>),
    Enum(TSEnum),
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq, Hash)]
pub struct TSEnum {
    pub name: String,
    pub values: Vec<TSEnumMember>,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq, Hash)]
pub struct TSEnumMember {
    pub name: String,
    pub value: TSEnumValue,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq, Hash)]
pub enum TSEnumValue {
    String(String),
    /// Number value for numeric enums (supports Enum8: -128 to 127, Enum16: -32768 to 32767)
    Number(i16),
}

impl fmt::Display for InterfaceFieldType {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            InterfaceFieldType::Null => write!(f, "null"),
            InterfaceFieldType::String => write!(f, "string"),
            InterfaceFieldType::Number => write!(f, "number"),
            InterfaceFieldType::Boolean => write!(f, "boolean"),
            InterfaceFieldType::Date => write!(f, "Date"),
            InterfaceFieldType::Array(inner_type) => write!(f, "{inner_type}[]"),
            InterfaceFieldType::Object(inner_type) => write!(f, "{}", inner_type.name),
            InterfaceFieldType::Enum(e) => write!(f, "{}", e.name),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TypescriptObjects {
    pub interface: TypescriptInterface,
}

impl TypescriptObjects {
    pub fn new(interface: TypescriptInterface) -> Self {
        Self { interface }
    }
}

pub struct TypescriptPackage {
    pub name: String,
    // version: String,
    // description: String,
    // author: String,
}

impl TypescriptPackage {
    pub fn new(name: String) -> Self {
        Self { name }
    }

    pub fn from_project(project: &Project) -> Self {
        Self {
            name: format!("{}-sdk", project.name().clone()),
        }
    }
}

// not maintained, see map_column_type_to_typescript in generate.rs
fn std_field_type_to_typescript_field_mapper(
    field_type: ColumnType,
) -> Result<InterfaceFieldType, TypescriptGeneratorError> {
    match field_type {
        ColumnType::String => Ok(InterfaceFieldType::String),
        ColumnType::FixedString { .. } => Ok(InterfaceFieldType::String),
        ColumnType::Boolean => Ok(InterfaceFieldType::Boolean),
        ColumnType::Int(_) => Ok(InterfaceFieldType::Number),
        ColumnType::Float(_) => Ok(InterfaceFieldType::Number),
        ColumnType::Decimal { .. } => Ok(InterfaceFieldType::Number),
        ColumnType::DateTime { .. } => Ok(InterfaceFieldType::Date),
        ColumnType::Array {
            element_type,
            element_nullable: _,
        } => {
            // TODO: add `| null`
            let inner_type = std_field_type_to_typescript_field_mapper(*element_type)?;
            Ok(InterfaceFieldType::Array(Box::new(inner_type)))
        }
        ColumnType::Bytes => Err(TypescriptGeneratorError::UnsupportedDataTypeError {
            type_name: "Bytes".to_string(),
        }),
        ColumnType::Enum(enum_type) => Ok(InterfaceFieldType::Enum(map_std_enum_to_ts(enum_type))),
        ColumnType::Json(_) => Err(TypescriptGeneratorError::UnsupportedDataTypeError {
            type_name: "Json".to_string(),
        }),
        ColumnType::BigInt => Err(TypescriptGeneratorError::UnsupportedDataTypeError {
            type_name: "BigInt".to_string(),
        }),
        ColumnType::Nested(inner) => {
            Ok(InterfaceFieldType::Object(Box::new(TypescriptInterface {
                name: inner.name,
                fields: inner
                    .columns
                    .iter()
                    .map(|c| {
                        Ok(InterfaceField {
                            name: c.name.clone(),
                            comment: None,
                            is_optional: !c.required,
                            field_type: std_field_type_to_typescript_field_mapper(
                                c.data_type.clone(),
                            )?,
                        })
                    })
                    .collect::<Result<Vec<InterfaceField>, TypescriptGeneratorError>>()?,
            })))
        }
        // add typia tag when we want to fully support UUID or Date
        ColumnType::Uuid => Ok(InterfaceFieldType::String),
        ColumnType::Date => Ok(InterfaceFieldType::String),
        ColumnType::Date16 => Ok(InterfaceFieldType::String),
        ColumnType::IpV4 => Ok(InterfaceFieldType::String),
        ColumnType::IpV6 => Ok(InterfaceFieldType::String),
        ColumnType::Point => Ok(InterfaceFieldType::Object(Box::new(TypescriptInterface {
            name: "Point".to_string(),
            fields: vec![
                InterfaceField {
                    name: "0".to_string(),
                    comment: None,
                    is_optional: false,
                    field_type: InterfaceFieldType::Number,
                },
                InterfaceField {
                    name: "1".to_string(),
                    comment: None,
                    is_optional: false,
                    field_type: InterfaceFieldType::Number,
                },
            ],
        }))),
        ColumnType::Ring | ColumnType::LineString => Ok(InterfaceFieldType::Array(Box::new(
            InterfaceFieldType::Object(Box::new(TypescriptInterface {
                name: "Point".to_string(),
                fields: vec![
                    InterfaceField {
                        name: "0".to_string(),
                        comment: None,
                        is_optional: false,
                        field_type: InterfaceFieldType::Number,
                    },
                    InterfaceField {
                        name: "1".to_string(),
                        comment: None,
                        is_optional: false,
                        field_type: InterfaceFieldType::Number,
                    },
                ],
            })),
        ))),
        ColumnType::MultiLineString | ColumnType::Polygon => Ok(InterfaceFieldType::Array(
            Box::new(InterfaceFieldType::Array(Box::new(
                InterfaceFieldType::Object(Box::new(TypescriptInterface {
                    name: "Point".to_string(),
                    fields: vec![
                        InterfaceField {
                            name: "0".to_string(),
                            comment: None,
                            is_optional: false,
                            field_type: InterfaceFieldType::Number,
                        },
                        InterfaceField {
                            name: "1".to_string(),
                            comment: None,
                            is_optional: false,
                            field_type: InterfaceFieldType::Number,
                        },
                    ],
                })),
            ))),
        )),
        ColumnType::MultiPolygon => Ok(InterfaceFieldType::Array(Box::new(
            InterfaceFieldType::Array(Box::new(InterfaceFieldType::Array(Box::new(
                InterfaceFieldType::Object(Box::new(TypescriptInterface {
                    name: "Point".to_string(),
                    fields: vec![
                        InterfaceField {
                            name: "0".to_string(),
                            comment: None,
                            is_optional: false,
                            field_type: InterfaceFieldType::Number,
                        },
                        InterfaceField {
                            name: "1".to_string(),
                            comment: None,
                            is_optional: false,
                            field_type: InterfaceFieldType::Number,
                        },
                    ],
                })),
            )))),
        ))),
        ColumnType::Nullable(inner) => {
            // For nullable types, just return the inner type - nullability is handled by is_optional
            std_field_type_to_typescript_field_mapper(*inner)
        }
        ColumnType::NamedTuple(fields) => {
            let mut interface_fields = Vec::new();
            for (name, field_type) in fields {
                let field_type = std_field_type_to_typescript_field_mapper(field_type)?;
                interface_fields.push(InterfaceField {
                    name: name.clone(),
                    comment: None,
                    is_optional: false,
                    field_type,
                });
            }
            Ok(InterfaceFieldType::Object(Box::new(TypescriptInterface {
                name: "NamedTuple".to_string(),
                fields: interface_fields,
            })))
        }
        ColumnType::Map {
            key_type: _,
            value_type: _,
        } => {
            // For Map types, we'll use a simple Object type for now
            // TypeScript's Record<K, V> is not directly representable in InterfaceFieldType
            Err(TypescriptGeneratorError::UnsupportedDataTypeError {
                type_name: "Map".to_string(),
            })
        }
    }
}

fn map_std_enum_to_ts(enum_type: DataEnum) -> TSEnum {
    let mut values: Vec<TSEnumMember> = Vec::new();

    for enum_member in enum_type.values {
        let enum_value = match enum_member.value {
            EnumValue::String(value) => TSEnumValue::String(value),
            EnumValue::Int(value) => TSEnumValue::Number(value),
        };

        values.push(TSEnumMember {
            name: enum_member.name,
            value: enum_value,
        });
    }

    TSEnum {
        name: enum_type.name,
        values,
    }
}

pub fn std_table_to_typescript_interface(
    table: Table,
    model_name: &str,
) -> Result<TypescriptInterface, TypescriptGeneratorError> {
    let mut fields: Vec<InterfaceField> = Vec::new();

    for column in table.columns {
        if matches!(&column.data_type, ColumnType::Nested(n) if n.jwt) {
            continue;
        }

        let typescript_interface_type =
            std_field_type_to_typescript_field_mapper(column.data_type.clone())?;

        fields.push(InterfaceField {
            name: column.name,
            field_type: typescript_interface_type,
            is_optional: !column.required,
            comment: Some(format!(
                "db_type:{} | isPrimary:{}",
                column.data_type, column.primary_key
            )),
        });
    }

    Ok(TypescriptInterface {
        name: model_name.to_string(),
        fields,
    })
}

pub fn move_to_npm_global_dir(sdk_location: &PathBuf) -> Result<PathBuf, std::io::Error> {
    //! Moves the generated SDK to the NPM global directory.
    //!
    //! *** Note *** This here doesn't work for typescript due to package resolution issues.
    //!
    //! # Arguments
    //! - `sdk_location` - The location of the generated SDK.
    //!
    //! # Returns
    //! - `Result<PathBuf, std::io::Error>` - A result containing the path where the SDK was moved to.
    //!
    let global_node_modules = package_managers::get_or_create_global_folder()?;

    system::copy_directory(sdk_location, &global_node_modules)?;

    Ok(global_node_modules)
}
