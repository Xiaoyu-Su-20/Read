use std::time::Instant;

use serde_json::{json, Value};

pub fn enabled() -> bool {
    cfg!(debug_assertions)
}

fn emit(event: &str, fields: Value) {
    if !enabled() {
        return;
    }

    println!(
        "{}",
        json!({
            "scope": "backend",
            "event": event,
            "fields": fields,
        })
    );
}

pub fn action(event: &str, fields: Value) {
    emit(event, fields);
}

pub struct DebugProcess {
    event: String,
    fields: Value,
    started_at: Instant,
}

pub fn process(event: impl Into<String>, fields: Value) -> DebugProcess {
    let event = event.into();
    emit(&format!("{event}:start"), fields.clone());

    DebugProcess {
        event,
        fields,
        started_at: Instant::now(),
    }
}

impl DebugProcess {
    pub fn checkpoint(&self, checkpoint: &str, fields: Value) {
        emit(
            &format!("{}:{checkpoint}", self.event),
            merge_fields(
                &self.fields,
                json!({
                    "elapsedMs": self.started_at.elapsed().as_millis(),
                }),
                fields,
            ),
        );
    }

    pub fn finish(self, fields: Value) {
        emit(
            &format!("{}:finish", self.event),
            merge_fields(
                &self.fields,
                json!({
                    "elapsedMs": self.started_at.elapsed().as_millis(),
                }),
                fields,
            ),
        );
    }

    pub fn fail(self, error: &str, fields: Value) {
        emit(
            &format!("{}:error", self.event),
            merge_fields(
                &self.fields,
                json!({
                    "elapsedMs": self.started_at.elapsed().as_millis(),
                    "error": error,
                }),
                fields,
            ),
        );
    }
}

fn merge_fields(base: &Value, meta: Value, extra: Value) -> Value {
    let mut merged = serde_json::Map::new();

    for value in [base, &meta, &extra] {
        if let Some(object) = value.as_object() {
            for (key, value) in object {
                merged.insert(key.clone(), value.clone());
            }
        }
    }

    Value::Object(merged)
}
