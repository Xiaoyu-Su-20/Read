#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    calm_reader_lib::debug::startup(
        "main.enter",
        serde_json::json!({
            "pid": std::process::id(),
        }),
    );
    calm_reader_lib::run();
    calm_reader_lib::debug::startup(
        "main.exit",
        serde_json::json!({
            "pid": std::process::id(),
        }),
    );
}
