// Model calls for the app. The API key is read and used only here, on the
// native side, so it never reaches the web page or the app bundle. The web
// page builds the request (src/lib/llm.ts) and asks this command to send it.
//
// Successful replies are saved to the app's cache folder, one file per
// request fingerprint. "Replay" mode reads those files instead of calling the
// endpoint, which is how the demo keeps working without a connection.

use std::{collections::HashMap, fs, path::PathBuf, time::Duration};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

/// Endpoint paths the web page may ask for. Anything else is refused.
const ALLOWED_PATHS: [&str; 1] = ["chat/completions"];

/// Thinking models can take a while; give up after three minutes.
const TIMEOUT: Duration = Duration::from_secs(180);

/// Shared by every call: where to send requests, the key, and one HTTP client
/// (reusing it keeps connections open between calls, which is faster).
pub struct LlmConfig {
    base_url: Option<String>,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl LlmConfig {
    /// Reads BC_BASE_URL and BC_API_KEY from the environment, or in
    /// development from the project's .env file.
    pub fn load() -> Self {
        let file = read_dotenv();
        let get = |name: &str| {
            std::env::var(name)
                .ok()
                .or_else(|| file.get(name).cloned())
                .filter(|value| !value.trim().is_empty())
        };
        Self {
            base_url: get("BC_BASE_URL").map(|url| url.trim_end_matches('/').to_string()),
            api_key: get("BC_API_KEY"),
            client: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .build()
                .expect("could not build the HTTP client"),
        }
    }
}

/// The project's .env, only in development builds (`pnpm tauri dev`).
/// `env!("CARGO_MANIFEST_DIR")` is the src-tauri folder, fixed at compile time.
fn read_dotenv() -> HashMap<String, String> {
    if !cfg!(debug_assertions) {
        return HashMap::new();
    }
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.env");
    let Ok(text) = fs::read_to_string(path) else {
        return HashMap::new();
    };
    text.lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_string(), value.trim().trim_matches('"').to_string()))
        .collect()
}

/// What the web page gets back. `source` is "live" or "cache".
#[derive(Serialize)]
pub struct Reply {
    status: u16,
    body: String,
    source: &'static str,
}

/// A failure the web page can act on. `kind` matches LlmErrorKind in llm.ts.
#[derive(Serialize)]
pub struct Failure {
    kind: &'static str,
    message: String,
}

fn fail(kind: &'static str, message: impl Into<String>) -> Failure {
    Failure { kind, message: message.into() }
}

fn cache_file(app: &AppHandle, cache_key: &str) -> Result<PathBuf, Failure> {
    // The key is a SHA-256 fingerprint: 64 hex characters. Checking that also
    // stops a crafted key from pointing outside the cache folder.
    if cache_key.len() != 64 || !cache_key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(fail("http", "Invalid cache key."));
    }
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| fail("network", format!("No cache folder: {e}")))?
        .join("llm");
    Ok(dir.join(format!("{cache_key}.json")))
}

/// Called from src/lib/llm-tauri.ts. In JavaScript the arguments are
/// { path, body, cacheKey, mode } (Tauri converts the names).
#[tauri::command]
pub async fn llm_request(
    app: AppHandle,
    config: State<'_, LlmConfig>,
    path: String,
    body: String,
    cache_key: String,
    mode: String,
) -> Result<Reply, Failure> {
    if !ALLOWED_PATHS.contains(&path.as_str()) {
        return Err(fail("http", format!("Path not allowed: {path}")));
    }
    let file = cache_file(&app, &cache_key)?;

    if mode == "replay" {
        return fs::read_to_string(&file)
            .map(|body| Reply { status: 200, body, source: "cache" })
            .map_err(|_| fail("not_cached", "No saved reply for this request."));
    }

    let (Some(base_url), Some(api_key)) = (&config.base_url, &config.api_key) else {
        return Err(fail("not_configured", "BC_BASE_URL or BC_API_KEY is missing."));
    };

    let response = config
        .client
        .post(format!("{base_url}/{path}"))
        .bearer_auth(api_key)
        .header("content-type", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| fail("network", format!("Could not reach the endpoint: {e}")))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| fail("network", format!("The reply was cut off: {e}")))?;

    if status.is_success() {
        // Saving is best effort: a failed write shouldn't fail the call.
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir).and_then(|_| fs::write(&file, &text));
        }
    }
    Ok(Reply { status: status.as_u16(), body: text, source: "live" })
}

/// Lets the UI say "model endpoint not set up" without revealing the key.
#[tauri::command]
pub fn llm_configured(config: State<'_, LlmConfig>) -> bool {
    config.base_url.is_some() && config.api_key.is_some()
}
