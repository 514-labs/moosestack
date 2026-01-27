use std::path::Path;

use itertools::Either;

use crate::framework::core::infrastructure::table::ColumnType;
use crate::framework::data_model::model::DataModel;
use crate::framework::languages::SupportedLanguages;
use crate::framework::python;
use crate::project::Project;

fn import_line(lang: SupportedLanguages, path: &str, names: &[&str]) -> String {
    match lang {
        SupportedLanguages::Typescript => {
            let names = names.join(", ");
            format!("import {{ {names} }} from \"{path}\";")
        }
        SupportedLanguages::Python => {
            let names = names.join(", ");
            format!("from {path} import {names}")
        }
    }
}

fn get_default_value_for_type(column_type: &ColumnType, lang: SupportedLanguages) -> String {
    match (column_type, lang) {
        (ColumnType::String | ColumnType::FixedString { .. }, _) => "\"\"".to_string(),
        (ColumnType::Boolean, _) => "false".to_string(),
        (ColumnType::Int(_), _) => "0".to_string(),
        (ColumnType::BigInt, _) => "0".to_string(),
        (ColumnType::Float(_), SupportedLanguages::Typescript) => "0".to_string(),
        (ColumnType::Float(_), SupportedLanguages::Python) => "0.0".to_string(),
        (ColumnType::Decimal { .. }, _) => "0".to_string(),
        (ColumnType::DateTime { .. }, SupportedLanguages::Typescript) => "new Date()".to_string(),
        (ColumnType::DateTime { .. }, SupportedLanguages::Python) => "datetime.now()".to_string(),
        (ColumnType::Enum(_), _) => "any".to_string(),
        (ColumnType::Array { .. }, _) => "[]".to_string(),
        (ColumnType::Nested(_), SupportedLanguages::Typescript) => "{}".to_string(),
        (ColumnType::Nested(inner), SupportedLanguages::Python) => format!("{}()", inner.name),
        (ColumnType::Json(_), _) => "{}".to_string(),
        (ColumnType::Bytes, _) => "[]".to_string(),
        (ColumnType::Uuid, SupportedLanguages::Typescript) => {
            "'4f487363-a767-491c-84ea-00b7724383d2'".to_string()
        }
        (ColumnType::Uuid, SupportedLanguages::Python) => "uuid.uuid4()".to_string(),
        (ColumnType::Date | ColumnType::Date16, _) => "'1970-01-01'".to_string(),
        (ColumnType::IpV4, SupportedLanguages::Typescript) => "'127.0.0.1'".to_string(),
        (ColumnType::IpV6, SupportedLanguages::Typescript) => "'::1'".to_string(),
        (ColumnType::IpV4, SupportedLanguages::Python) => {
            "ipaddress.IPv4Address('127.0.0.1')".to_string()
        }
        (ColumnType::IpV6, SupportedLanguages::Python) => {
            "ipaddress.IPv6Address('::1')".to_string()
        }
        (ColumnType::Nullable(inner), lang) => get_default_value_for_type(inner, lang),
        (ColumnType::NamedTuple(fields), lang) => {
            let mut field_defaults = Vec::new();
            for (name, field_type) in fields {
                let default = get_default_value_for_type(field_type, lang);
                field_defaults.push(format!("{name}: {default}"));
            }
            match lang {
                SupportedLanguages::Typescript => {
                    format!("{{ {defaults} }}", defaults = field_defaults.join(", "))
                }
                SupportedLanguages::Python => {
                    format!("{{ {defaults} }}", defaults = field_defaults.join(", "))
                }
            }
        }
        (ColumnType::Point, SupportedLanguages::Typescript) => "[0, 0]".to_string(),
        (ColumnType::Point, SupportedLanguages::Python) => "(0.0, 0.0)".to_string(),
        (ColumnType::Ring | ColumnType::LineString, _) => "[]".to_string(),
        (ColumnType::MultiLineString | ColumnType::Polygon, _) => "[]".to_string(),
        (ColumnType::MultiPolygon, _) => "[]".to_string(),
        (
            ColumnType::Map {
                key_type,
                value_type,
            },
            lang,
        ) => {
            let key_default = get_default_value_for_type(key_type, lang);
            let value_default = get_default_value_for_type(value_type, lang);
            match lang {
                SupportedLanguages::Typescript => {
                    format!("{{ [{key_default}]: {value_default} }}")
                }
                SupportedLanguages::Python => format!("{{ {key_default}: {value_default} }}"),
            }
        }
    }
}
fn get_import_path(data_model: Either<&DataModel, &str>, project: &Project) -> String {
    match data_model {
        Either::Left(dm) => get_data_model_import_path(dm, project),
        Either::Right(_name) => match project.language {
            SupportedLanguages::Typescript => "datamodels/models".to_string(),
            SupportedLanguages::Python => "app.datamodels.models".to_string(),
        },
    }
}
fn get_data_model_import_path(data_model: &DataModel, project: &Project) -> String {
    match data_model.abs_file_path.strip_prefix(
        project
            .old_version_location(data_model.version.as_str())
            .unwrap(),
    ) {
        Ok(relative_path) => match project.language {
            SupportedLanguages::Typescript => {
                format!(
                    "versions/{}/{}",
                    &data_model.version,
                    relative_path.with_extension("").to_string_lossy()
                )
            }
            SupportedLanguages::Python => python_path_to_module(
                relative_path,
                Some(python::version_to_identifier(&data_model.version)),
            ),
        },
        Err(_) => {
            assert_eq!(&data_model.version, project.cur_version());
            match project.language {
                SupportedLanguages::Typescript => format!(
                    "datamodels/{}",
                    data_model
                        .abs_file_path
                        .with_extension("")
                        .strip_prefix(project.data_models_dir())
                        .unwrap()
                        .to_string_lossy()
                ),
                SupportedLanguages::Python => {
                    let relative_path_from_root = data_model
                        .abs_file_path
                        .strip_prefix(&project.project_location)
                        .unwrap_or(&data_model.abs_file_path);

                    python_path_to_module(relative_path_from_root, None)
                }
            }
        }
    }
}

fn python_path_to_module(relative_file_path: &Path, base: Option<String>) -> String {
    let relative_file_path = relative_file_path.with_extension("");

    let mut path = base.unwrap_or("".to_string());
    for path_segment in &relative_file_path {
        if !path.is_empty() {
            path.push('.');
        }
        path.push_str(&path_segment.to_string_lossy())
    }
    path
}
