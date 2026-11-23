use serde_json::{json, Value};
use tokio::process::Command;

use crate::errors::{bad_request, AppError, AppResult};

/// Only this fixed list can be installed from the UI; nothing here is free-form.
const COMPONENTS: &[(&str, &str, &str, &[&str])] = &[
    ("git", "Git", "git", &["git"]),
    ("node", "Node.js", "node", &["nodejs", "npm"]),
    ("pnpm", "pnpm", "pnpm", &["nodejs", "npm"]),
    ("rust", "Rust", "rustc", &["rustc", "cargo"]),
    ("go", "Go", "go", &["golang-go"]),
    (
        "python",
        "Python",
        "python3",
        &["python3", "python3-pip", "python3-venv"],
    ),
];

fn component(
    id: &str,
) -> AppResult<&'static (
    &'static str,
    &'static str,
    &'static str,
    &'static [&'static str],
)> {
    COMPONENTS
        .iter()
        .find(|(key, _, _, _)| *key == id)
        .ok_or_else(|| bad_request("Componente desconhecido."))
}

fn installed(binary: &str) -> bool {
    std::process::Command::new("sh")
        .arg("-c")
        .arg(format!("command -v {binary} >/dev/null 2>&1"))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

pub fn status() -> Value {
    json!({
        "components": COMPONENTS
            .iter()
            .map(|(id, label, binary, _)| json!({
                "id": id,
                "label": label,
                "installed": installed(binary),
            }))
            .collect::<Vec<_>>(),
    })
}

pub async fn install(id: &str) -> AppResult<Value> {
    let (_, label, _, packages) = component(id)?;
    if packages.is_empty() {
        return Err(bad_request("Componente sem pacotes."));
    }
    let root = unsafe { libc::geteuid() } == 0;
    let mut command = if root {
        let mut command = Command::new("apt-get");
        command.args([
            "-o",
            "Acquire::http::Timeout=30",
            "-o",
            "Acquire::https::Timeout=30",
            "install",
            "-y",
            "--no-install-recommends",
        ]);
        command
    } else {
        let mut command = Command::new("sudo");
        command.args([
            "-n",
            "apt-get",
            "-o",
            "Acquire::http::Timeout=30",
            "-o",
            "Acquire::https::Timeout=30",
            "install",
            "-y",
            "--no-install-recommends",
        ]);
        command
    };
    command.args(*packages);
    let output = command
        .output()
        .await
        .map_err(|error| AppError::ServiceUnavailable(format!("apt-get indisponível: {error}")))?;
    let stdout = String::from_utf8_lossy(&output.stdout)
        .chars()
        .take(8_000)
        .collect::<String>();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .chars()
        .take(4_000)
        .collect::<String>();
    if !output.status.success() {
        return Err(AppError::ServiceUnavailable(format!(
            "Não foi possível instalar {label}. {}",
            if stderr.trim().is_empty() {
                stdout
            } else {
                stderr
            }
        )));
    }
    Ok(json!({
        "ok": true,
        "component": id,
        "output": stdout,
    }))
}
