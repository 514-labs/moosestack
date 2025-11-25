use itertools::Itertools;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;

use crate::framework::core::infrastructure::table::{Column, OrderBy, Table};
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
        // Determine the order_by based on configuration and primary keys
        let order_by: OrderBy = if !self.config.storage.order_by_fields.is_empty() {
            OrderBy::Fields(self.config.storage.order_by_fields.clone())
        } else {
            // Fall back to primary key columns if no explicit order_by_fields
            // This ensures ClickHouse's mandatory ORDER BY requirement is met
            OrderBy::Fields(self.primary_key_columns())
        };

        let engine = if self.config.storage.deduplicate {
            ClickhouseEngine::ReplacingMergeTree {
                ver: None,
                is_deleted: None,
            }
        } else {
            ClickhouseEngine::MergeTree
        };

        // Create the table first, then compute the combined hash that includes database
        let mut table = Table {
            name: self
                .config
                .storage
                .name
                .clone()
                .unwrap_or_else(|| format!("{}_{}", self.name, self.version.as_suffix())),
            columns: self.columns.clone(),
            order_by,
            partition_by: None,
            sample_by: None,
            engine,
            version: Some(self.version.clone()),
            source_primitive: PrimitiveSignature {
                name: self.name.clone(),
                primitive_type: PrimitiveTypes::DataModel,
            },
            metadata: None,
            life_cycle: LifeCycle::FullyManaged,
            engine_params_hash: None, // Will be computed below
            table_settings: None,     // TODO: Parse table_settings from data model config
            indexes: vec![],
            database: None, // Database defaults to global config
            table_ttl_setting: None,
            cluster_name: None,
            primary_key_expression: None,
        };

        // Compute hash that includes both engine params and database
        table.engine_params_hash = table.compute_non_alterable_params_hash();
        table
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
     * Uses SHA256 for stable, deterministic hashing.
     */
    pub fn hash_without_version(&self) -> u64 {
        let mut hasher = Sha256::new();

        // Hash the name
        hasher.update(self.name.as_bytes());

        // Hash columns in a deterministic way
        for column in &self.columns {
            hasher.update(column.name.as_bytes());
            hasher.update(format!("{:?}", column.data_type).as_bytes());
            hasher.update(column.required.to_string().as_bytes());
            hasher.update(column.unique.to_string().as_bytes());
            hasher.update(column.primary_key.to_string().as_bytes());
            if let Some(ref default) = column.default {
                hasher.update(default.as_bytes());
            } else {
                hasher.update("None".as_bytes());
            }
            // Hash annotations in sorted order for determinism
            let mut sorted_annotations: Vec<_> = column.annotations.iter().collect();
            sorted_annotations.sort_by_key(|(k, _)| k.clone());
            for (key, value) in sorted_annotations {
                hasher.update(key.as_bytes());
                hasher.update(format!("{:?}", value).as_bytes());
            }
        }

        // Hash config
        hasher.update(format!("{:?}", self.config).as_bytes());

        // Convert first 8 bytes of SHA256 to u64 for backward compatibility
        let hash_bytes = hasher.finalize();
        u64::from_be_bytes([
            hash_bytes[0],
            hash_bytes[1],
            hash_bytes[2],
            hash_bytes[3],
            hash_bytes[4],
            hash_bytes[5],
            hash_bytes[6],
            hash_bytes[7],
        ])
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
