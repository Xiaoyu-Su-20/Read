use std::{env, sync::OnceLock, time::{Instant, SystemTime, UNIX_EPOCH}};

use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

fn configured_log_level() -> LogLevel {
    static LOG_LEVEL: OnceLock<LogLevel> = OnceLock::new();

    *LOG_LEVEL.get_or_init(|| match env::var("READER_LOG_LEVEL") {
        Ok(value) => match value.trim().to_ascii_lowercase().as_str() {
            "error" => LogLevel::Error,
            "warn" => LogLevel::Warn,
            "info" => LogLevel::Info,
            "debug" => LogLevel::Debug,
            "trace" => LogLevel::Trace,
            _ => LogLevel::Info,
        },
        Err(_) => LogLevel::Info,
    })
}

pub fn enabled() -> bool {
    cfg!(debug_assertions)
}

fn event_level(event: &str) -> LogLevel {
    if event.ends_with(":error")
        || event == "pdf-runtime.ensure-document-error"
        || event == "pdf-runtime.page-text-error"
    {
        return LogLevel::Error;
    }

    if event == "reader.render-stale-ignored" {
        return LogLevel::Warn;
    }

    if matches!(
        event,
        "reader.open:click"
            | "reader.open:document-ready"
            | "reader.initial-page:resolved"
            | "reader.open:active-document-committed"
            | "view.collection:click"
            | "view.collection:state-committed"
            | "view.collection:first-painted"
            | "view.document:click"
            | "view.document:state-committed"
            | "view.document:component-mounted"
            | "view.document:first-painted"
            | "reader:mounted"
            | "reader:unmounted"
            | "pdf-runtime:dispose-start"
            | "pdf-runtime:dispose-finished"
            | "reader.render:first-request"
            | "reader.render:response-received"
            | "viewer.image:src-assigned"
            | "viewer.image:load"
            | "viewer.image:decode-finished"
            | "reader.first-visible"
            | "reader.open:summary"
            | "pdf-runtime.ensure-document-error"
            | "pdf-runtime.page-text-error"
            | "command.render_pdf_page:execution-started"
            | "command.render_pdf_page:document-path-resolved"
            | "command.render_pdf_page:join-in-flight"
            | "command.render_pdf_page:skipped-stale-generation"
    ) {
        return LogLevel::Info;
    }

    if event.starts_with("store.render_pdf_page_blocking:") {
        return LogLevel::Info;
    }

    LogLevel::Trace
}

fn emit(event: &str, fields: Value) {
    if !enabled() || event_level(event) > configured_log_level() {
        return;
    }

    let at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);

    println!(
        "{}",
        json!({
            "scope": "backend",
            "event": event,
            "atMs": at_ms,
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
