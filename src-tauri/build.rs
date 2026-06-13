use std::{fs, path::Path};

fn watch_path(path: &Path) {
    println!("cargo:rerun-if-changed={}", path.display());

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            watch_path(&entry.path());
        }
    }
}

fn main() {
    watch_path(Path::new("tauri.conf.json"));
    watch_path(Path::new("icons"));

    tauri_build::build()
}
