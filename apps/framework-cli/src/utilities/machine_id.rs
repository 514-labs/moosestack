use home::home_dir;
use std::fs;
use std::path::PathBuf;
use tracing::warn;
use uuid::Uuid;

const MACHINE_ID_FILE: &str = ".fiveonefour/machine_id";

/// Gets or creates a tracking ID from ~/.fiveonefour/machine_id
/// If the file exists, returns the existing ID
/// If not, generates a new UUIDv4 and saves it
pub fn get_or_create_machine_id() -> String {
    let machine_id_path = get_machine_id_path();

    // Check if file exists and has content
    if let Ok(content) = fs::read_to_string(&machine_id_path) {
        let trimmed = content.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }

    // Generate a new ID if file doesn't exist or is empty
    let new_id = Uuid::new_v4().to_string();

    // Create directory if it doesn't exist
    if let Some(parent) = machine_id_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            warn!("Failed to create directory for machine ID: {}", e);
            return new_id;
        }
    }

    // Write the new ID to file
    if let Err(e) = fs::write(&machine_id_path, &new_id) {
        warn!("Failed to write machine ID to file: {}", e);
    }

    new_id
}

fn get_machine_id_path() -> PathBuf {
    home_dir()
        .expect("Could not determine home directory")
        .join(MACHINE_ID_FILE)
}
