use std::{
    env,
    fs::{metadata, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicU8, Ordering},
        OnceLock,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum LogLevel {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
    Trace = 4,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum LogPolicy {
    ErrorsOnly = 1,
    Verbose = 2,
}

const ERROR_LOG_MAX_BYTES: u64 = 256 * 1024;
const SUPPORT_LOG_MAX_BYTES: u64 = 1024 * 1024;

fn default_policy() -> LogPolicy {
    if cfg!(debug_assertions) {
        return LogPolicy::Verbose;
    }

    match env::var("READR_SUPPORT_LOG") {
        Ok(value) if value.trim() == "1" => LogPolicy::Verbose,
        _ => LogPolicy::ErrorsOnly,
    }
}

fn session_support_logging_override() -> &'static AtomicU8 {
    static SESSION_OVERRIDE: OnceLock<AtomicU8> = OnceLock::new();
    SESSION_OVERRIDE.get_or_init(|| AtomicU8::new(0))
}

fn current_policy() -> LogPolicy {
    match session_support_logging_override().load(Ordering::Relaxed) {
        1 => LogPolicy::Verbose,
        _ => default_policy(),
    }
}

pub fn current_policy_name() -> &'static str {
    match current_policy() {
        LogPolicy::ErrorsOnly => "errors-only",
        LogPolicy::Verbose => "verbose",
    }
}

pub fn set_support_logging_enabled(enabled: bool) {
    session_support_logging_override().store(if enabled { 1 } else { 0 }, Ordering::Relaxed);
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

fn error_log_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| env::temp_dir().join("readr-errors.log"))
        .clone()
}

fn support_log_path() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| env::temp_dir().join("readr-support.log"))
        .clone()
}

fn event_level(event: &str) -> LogLevel {
    if event.ends_with(":error")
        || event.ends_with("-error")
        || event.ends_with(".error")
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
            | "view.collection:first-frame"
            | "view.collection:pointer-down"
            | "view.collection:presented"
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
            | "frontend.event-loop-gap"
            | "frontend.long-task"
            | "frontend.native-text.requested"
            | "frontend.native-text.response-received"
            | "frontend.native-text.response-discarded"
            | "frontend.native-text.state-enqueued"
            | "frontend.native-text.load-failed"
            | "frontend.native-text-layer.mounted"
            | "frontend.native-text-layer.ready"
            | "frontend.native-text-layer.missing"
            | "frontend.native-text-layer.unmounted"
            | "frontend.native-text-layer.selectable-frame"
            | "reader.outline-load-scheduled"
            | "reader.outline-load-started"
            | "reader.outline-load-completed"
            | "reader.outline-load-cancelled"
            | "reader.outline-load-failed"
            | "pdf-runtime.ensure-document-start"
            | "pdf-runtime.ensure-document-cache-hit"
            | "pdf-runtime.bytes-read-start"
            | "pdf-runtime.bytes-loaded"
            | "pdf-runtime.bytes-converted"
            | "pdf-runtime.document-load-start"
            | "pdf-runtime.document-loaded"
            | "pdf-runtime.ensure-document-error"
            | "pdf-runtime.page-text-error"
            | "command.render_pdf_page:execution-started"
            | "command.render_pdf_page:document-path-resolved"
            | "command.render_pdf_page:join-in-flight"
            | "command.render_pdf_page:skipped-stale-generation"
            | "command.get_pdf_native_text_page:execution-started"
            | "command.get_pdf_native_text_page:skipped-stale-generation"
            | "command.get_pdf_native_outline:execution-started"
            | "command.get_pdf_native_outline:skipped-stale-generation"
            | "command.warm_pdf_display_lists:skipped-stale-generation"
            | "render-session.created"
            | "render-session.document-opened"
            | "native-outline.loaded"
            | "native-text.cache-hit"
            | "native-text.cache-miss"
            | "native-text.loaded"
            | "display-list.cache-hit"
            | "display-list.cache-miss"
            | "display-list.loaded"
            | "display-list.warm-start"
            | "display-list.warm-finish"
    ) {
        return LogLevel::Info;
    }

    if event.starts_with("store.render_pdf_page_blocking:") {
        return LogLevel::Info;
    }

    LogLevel::Trace
}

fn should_redact_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("path")
        || key.contains("content")
        || key.contains("text")
        || key.contains("body")
        || key.contains("selection")
        || key.contains("raw")
        || key.contains("bytes")
}

fn sanitize_value(key_hint: Option<&str>, value: &Value, verbose: bool) -> Value {
    if verbose {
        return value.clone();
    }

    if let Some(key) = key_hint {
        if should_redact_key(key) {
            return Value::String("[redacted]".to_string());
        }
    }

    match value {
        Value::Object(object) => {
            let mut sanitized = serde_json::Map::new();
            for (key, child_value) in object {
                sanitized.insert(
                    key.clone(),
                    sanitize_value(Some(key.as_str()), child_value, verbose),
                );
            }
            Value::Object(sanitized)
        }
        Value::Array(values) => Value::Array(
            values
                .iter()
                .take(25)
                .map(|child_value| sanitize_value(None, child_value, verbose))
                .collect(),
        ),
        Value::String(text) => {
            let max_len = 240;
            if text.chars().count() <= max_len {
                Value::String(text.clone())
            } else {
                Value::String(format!("{}…", text.chars().take(max_len).collect::<String>()))
            }
        }
        _ => value.clone(),
    }
}

fn write_log_record(path: PathBuf, payload: &Value, max_bytes: u64) {
    let serialized = payload.to_string();
    let needs_truncate = metadata(&path)
        .map(|metadata| metadata.len() >= max_bytes)
        .unwrap_or(false);

    let mut options = OpenOptions::new();
    options.create(true).write(true);
    if needs_truncate {
        options.truncate(true);
    } else {
        options.append(true);
    }

    if let Ok(mut file) = options.open(path) {
        let _ = writeln!(file, "{serialized}");
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn base_payload(scope: &str, event: &str, fields: Value) -> Value {
    json!({
        "scope": scope,
        "event": event,
        "atMs": now_ms(),
        "version": env!("CARGO_PKG_VERSION"),
        "platform": env::consts::OS,
        "fields": fields,
    })
}

fn emit_trace(event: &str, fields: Value) {
    if current_policy() != LogPolicy::Verbose || event_level(event) > configured_log_level() {
        return;
    }

    let payload = base_payload("backend-trace", event, fields);
    println!("{payload}");
    write_log_record(support_log_path(), &payload, SUPPORT_LOG_MAX_BYTES);
}

pub fn report_error(event: &str, fields: Value) {
    let verbose = current_policy() == LogPolicy::Verbose;
    let payload = base_payload(
        "backend-error",
        event,
        sanitize_value(None, &fields, verbose),
    );

    if verbose {
        eprintln!("{payload}");
        write_log_record(support_log_path(), &payload, SUPPORT_LOG_MAX_BYTES);
    }

    write_log_record(error_log_path(), &payload, ERROR_LOG_MAX_BYTES);
}

pub fn action(event: &str, fields: Value) {
    if event_level(event) == LogLevel::Error {
        report_error(event, fields);
        return;
    }

    emit_trace(event, fields);
}

pub fn startup(event: &str, fields: Value) {
    emit_trace(event, fields);
}

pub struct DebugProcess {
    event: String,
    fields: Value,
    started_at: Instant,
}

pub fn process(event: impl Into<String>, fields: Value) -> DebugProcess {
    let event = event.into();
    emit_trace(&format!("{event}:start"), fields.clone());

    DebugProcess {
        event,
        fields,
        started_at: Instant::now(),
    }
}

impl DebugProcess {
    pub fn checkpoint(&self, checkpoint: &str, fields: Value) {
        emit_trace(
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
        emit_trace(
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
        report_error(
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
