use itertools::Itertools;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

use crate::framework::core::infrastructure::table::{Column, Table};
use crate::framework::core::infrastructure_map::{PrimitiveSignature, PrimitiveTypes};
use crate::framework::core::partial_infrastructure_map::LifeCycle;
use crate::framework::data_model::DuplicateModelError;
use crate::framework::versions::{find_previous_version, parse_version, Version};
use crate::infrastructure::olap::clickhouse::queries::ClickhouseEngine;

use super::config::DataModelConfig;

#[derive(Debug, Clone, Serialize, Deserialize, Eq, PartialEq)]
pub struct DataModel {
    pub columns: Vec<Column>,
    pub name: String,
    #[serde(default)]
    pub config: DataModelConfig,
    pub abs_file_path: PathBuf,
    pub version: Version,
}

impl DataModel {
    // TODO this probably should be on the Table object itself which can be built from
    // multiple sources. The Aim will be to have DB Blocks provision some tables as well.
    pub fn to_table(&self) -> Table {
        // Determine the order_by fields based on configuration and primary keys
        let order_by = if !self.config.storage.order_by_fields.is_empty() {
            // Use explicit order_by_fields if specified
            self.config.storage.order_by_fields.clone()
        } else {
            // Fall back to primary key columns if no explicit order_by_fields
            // This ensures ClickHouse's mandatory ORDER BY requirement is met
            self.primary_key_columns()
        };

        Table {
            name: self
                .config
                .storage
                .name
                .clone()
                .unwrap_or_else(|| format!("{}_{}", self.name, self.version.as_suffix())),
            columns: self.columns.clone(),
            order_by,
            engine: self
                .config
                .storage
                .deduplicate
                .then_some(ClickhouseEngine::ReplacingMergeTree),
            version: Some(self.version.clone()),
            source_primitive: PrimitiveSignature {
                name: self.name.clone(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
        }
    }

    pub fn primary_key_columns(&self) -> Vec<String> {
        self.columns
            .iter()
            .filter_map(|c| {
                if c.primary_key {
                    Some(c.name.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    /**
     * This hash is used to determine if the data model has changed.
     * It does not include the version in the hash and the abs_file_path is not included.
     */
    pub fn hash_without_version(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        self.name.hash(&mut hasher);
        self.columns.hash(&mut hasher);
        self.config.hash(&mut hasher);

        hasher.finish()
    }

    pub fn id(&self) -> String {
        DataModel::model_id(&self.name, &self.version.as_suffix())
    }

    pub fn model_id(name: &str, version: &str) -> String {
        format!("{name}_{version}")
    }
}

#[derive(Debug, Clone, Default)]
pub struct DataModelSet {
    // DataModelName -> Version -> DataModel
    models: HashMap<String, HashMap<String, DataModel>>,
}

impl DataModelSet {
    pub fn new() -> Self {
        DataModelSet {
            models: HashMap::new(),
        }
    }

    pub fn add(&mut self, model: DataModel) -> Result<(), DuplicateModelError> {
        let versions: &mut HashMap<String, DataModel> =
            self.models.entry(model.name.clone()).or_default();

        DuplicateModelError::try_insert_core_v2(versions, model)
    }

    pub fn get(&self, name: &str, version: &str) -> Option<&DataModel> {
        self.models.get(name).and_then(|hash| hash.get(version))
    }

    pub fn remove(&mut self, name: &str, version: &str) {
        match self.models.get_mut(name) {
            None => (),
            Some(versions) => {
                versions.remove(version);
                if self.models.get(name).is_some_and(|hash| hash.is_empty()) {
                    self.models.remove(name);
                }
            }
        }
    }

    /**
     * Checks if the data model has changed with the previous version.
     * If the model did not exist in the previous version, it will return true.
     */
    pub fn has_data_model_changed_with_previous_version(&self, name: &str, version: &str) -> bool {
        match self.models.get(name) {
            Some(versions) => match find_previous_version(versions.keys(), version) {
                Some(previous_version) => {
                    let previous_model = versions.get(&previous_version).unwrap();
                    let current_model = versions.get(version).unwrap();
                    previous_model.hash_without_version() != current_model.hash_without_version()
                }
                None => true,
            },
            None => true,
        }
    }

    /**
     * Finds the earliest version of the data model that has the same hash as the current version.
     * This method assumes that at least the previous version has the same hash as the current version.
     * But the similarity could be further back in the history.
     */
    pub fn find_earliest_similar_version(&self, name: &str, version: &str) -> Option<&DataModel> {
        match self.models.get(name) {
            Some(versions) => {
                let mut versions_parsed: VecDeque<(Vec<i32>, &DataModel)> = versions
                    .iter()
                    .map(|(version, data_model)| (parse_version(version.as_ref()), data_model))
                    // Reverse sorting, from the newest version to the oldest.
                    .sorted_by(|version_a, version_b| version_b.0.cmp(&version_a.0))
                    .collect();

                let current_version_parsed = parse_version(version);
                let current_hash = self.get(name, version).unwrap().hash_without_version();

                // We remove all the newer versions from the list before the version considered.
                let mut earlier_version = versions_parsed.pop_front();
                while earlier_version.is_some() {
                    let (version, _) = earlier_version.unwrap();
                    if current_version_parsed == version {
                        break;
                    } else {
                        earlier_version = versions_parsed.pop_front();
                    }
                }

                // We go back in history to find the earliest version that has the same hash as the current
                // version.
                earlier_version = versions_parsed.pop_front();
                let mut previously_similar = None;
                while earlier_version.is_some() {
                    let (_, data_model) = earlier_version.unwrap();
                    let hash: u64 = data_model.hash_without_version();
                    if hash == current_hash {
                        previously_similar = Some(data_model);
                        earlier_version = versions_parsed.pop_front();
                    } else {
                        return previously_similar;
                    }
                }

                previously_similar
            }
            None => None,
        }
    }

    pub fn iter(&self) -> impl Iterator<Item = &DataModel> {
        self.models.values().flat_map(|versions| versions.values())
    }
}
