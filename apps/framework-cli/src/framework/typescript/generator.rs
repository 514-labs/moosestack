use convert_case::{Case, Casing};
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::hash::Hash;
use std::path::Path;
use std::{fmt, path::PathBuf};

use crate::framework::core::primitive_map::PrimitiveMap;
use crate::framework::typescript;
use crate::{
    project::Project,
    utilities::{package_managers, system},
};

use super::templates::TypescriptRenderingError;
use crate::framework::core::infrastructure::table::{ColumnType, DataEnum, EnumValue, Table};
use crate::utilities::constants::TSCONFIG_JSON;

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
    Number(u8),
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
        ColumnType::Json => Err(TypescriptGeneratorError::UnsupportedDataTypeError {
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
        // Geo types - return as String for now since InterfaceFieldType doesn't have custom types
        ColumnType::Point
        | ColumnType::Ring
        | ColumnType::LineString
        | ColumnType::MultiLineString
        | ColumnType::Polygon
        | ColumnType::MultiPolygon => Ok(InterfaceFieldType::String),
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

pub fn generate_sdk(
    project: &Project,
    primitive_map: &PrimitiveMap,
    sdk_dir: &Path,
    packaged: &bool,
) -> Result<(), TypescriptGeneratorError> {
    //! Generates a Typescript SDK for the given project and returns the path where the SDK was generated.
    //!
    //! # Arguments
    //! - `project` - The project to generate the SDK for.
    //! - `primitive_map` - The primitive map to generate the SDK for.
    //! - `sdk_dir` - Where to write the generated SDK.
    //! - `packaged` - Whether or not to generate a full fledged package or just the source files in the language of choice.
    //!
    //! # Returns
    //! - `Result<(), TypescriptGeneratorError>` - A result indicating success or failure.

    let current_version_ts_objects =
        collect_ts_objects_from_primitive_map(primitive_map, project.cur_version().as_str())?;
    let enums = collect_enums_from_primitive_map(primitive_map, project.cur_version().as_str());

    std::fs::remove_dir_all(sdk_dir).or_else(|err| match err.kind() {
        std::io::ErrorKind::NotFound => Ok(()),
        _ => Err(err),
    })?;
    std::fs::create_dir_all(sdk_dir)?;

    if *packaged {
        let package = TypescriptPackage::from_project(project);
        let package_json_code = typescript::templates::render_package_json(&package.name)?;
        fs::write(sdk_dir.join("package.json"), package_json_code)?;
        let ts_config_code = typescript::templates::render_ts_config()?;
        fs::write(sdk_dir.join(TSCONFIG_JSON), ts_config_code)?;
    }

    let index_code = typescript::templates::render_ingest_client(
        project.cur_version().as_str(),
        &current_version_ts_objects,
    )?;
    fs::write(sdk_dir.join("index.ts"), index_code)?;

    if !enums.is_empty() {
        let current_enum_code = typescript::templates::render_enums(enums)?;
        fs::write(sdk_dir.join("enums.ts"), current_enum_code)?;
    }

    for obj in current_version_ts_objects.iter() {
        let interface_code = obj.interface.create_code()?;
        fs::write(
            sdk_dir.join(obj.interface.file_name_with_extension()),
            interface_code,
        )?;
    }

    Ok(())
}

fn collect_ts_objects_from_primitive_map(
    primitive_map: &PrimitiveMap,
    version: &str,
) -> Result<Vec<TypescriptObjects>, TypescriptGeneratorError> {
    primitive_map
        .data_models_iter()
        .filter(|model| model.version.as_str() == version)
        .map(|model| {
            std_table_to_typescript_interface(model.to_table(), &model.name)
                .map(TypescriptObjects::new)
        })
        .collect()
}

fn collect_enums_from_primitive_map(
    primitive_map: &PrimitiveMap,
    version: &str,
) -> HashSet<TSEnum> {
    primitive_map
        .data_models_iter()
        .filter(|model| model.version.as_str() == version)
        .flat_map(|model| {
            model.columns.iter().filter_map(|column| {
                if let ColumnType::Enum(enum_type) = &column.data_type {
                    Some(map_std_enum_to_ts(enum_type.clone()))
                } else {
                    None
                }
            })
        })
        .collect()
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
