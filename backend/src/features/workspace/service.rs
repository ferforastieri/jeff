use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, RwLock};

use chrono::{DateTime, Utc};
use tokio::process::Command;
use walkdir::WalkDir;

use crate::errors::{bad_request, AppError, AppResult};
use crate::model::{
    FileContent, FileEntry, GitBlameLine, GitBranches, GitHistoryEntry, Repository, SearchMatch,
};
use serde_json::{json, Value};

const MAX_READ_SIZE: u64 = 5 * 1024 * 1024;

fn ignored_dir(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | "node_modules"
            | ".next"
            | "dist"
            | "build"
            | ".cache"
            | "vendor"
            | ".gradle"
            | ".idea"
            | ".vscode"
            | "target"
            | "bin"
            | "__pycache__"
            | ".venv"
            | "venv"
            | ".pytest_cache"
            | ".mypy_cache"
            | ".turbo"
            | ".parcel-cache"
            | ".nuxt"
            | ".svelte-kit"
            | "coverage"
            | "Pods"
            | "DerivedData"
            | "_build"
            | "obj"
            | ".terraform"
    )
}

#[derive(Clone)]
pub struct WorkspaceService {
    roots: Arc<RwLock<Vec<PathBuf>>>,
    repos_cache: Arc<RwLock<Option<(std::time::Instant, Vec<Repository>)>>>,
}

impl WorkspaceService {
    pub fn new(roots: Vec<PathBuf>) -> AppResult<Self> {
        let resolved = resolve_roots(&roots)?;
        Ok(Self {
            roots: Arc::new(RwLock::new(resolved)),
            repos_cache: Arc::new(RwLock::new(None)),
        })
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.roots
            .read()
            .map(|roots| roots.clone())
            .unwrap_or_default()
    }

    pub fn add_root(&self, root: &Path) -> AppResult<PathBuf> {
        let resolved = resolve_root(root)?;
        let mut roots = self
            .roots
            .write()
            .map_err(|_| crate::errors::internal("root lock"))?;
        if !roots.iter().any(|existing| existing == &resolved) {
            roots.push(resolved.clone());
        }
        if let Ok(mut cache) = self.repos_cache.write() {
            *cache = None;
        }
        Ok(resolved)
    }

    pub fn remove_root(&self, root: &Path) -> AppResult<()> {
        let resolved = resolve_root(root)?;
        let mut roots = self
            .roots
            .write()
            .map_err(|_| crate::errors::internal("root lock"))?;
        if let Some(index) = roots.iter().position(|existing| existing == &resolved) {
            roots.remove(index);
            return Ok(());
        }
        Err(AppError::Forbidden)
    }

    pub fn validate_root(&self, root: &Path) -> AppResult<PathBuf> {
        let resolved = resolve_root(root)?;
        let allowed = self.roots();
        if allowed
            .iter()
            .any(|allowed| resolved == *allowed || resolved.starts_with(allowed))
        {
            return Ok(resolved);
        }
        Err(AppError::Forbidden)
    }

    pub fn list(&self, root: &Path, relative: &str) -> AppResult<Vec<FileEntry>> {
        let dir = resolve_existing(root, relative)?;
        if !dir.is_dir() {
            return Err(crate::errors::bad_request(format!(
                "{relative:?} is not a directory"
            )));
        }
        let mut entries = Vec::new();
        for item in fs::read_dir(&dir)? {
            let Ok(item) = item else { continue };
            let name = item.file_name().to_string_lossy().to_string();
            if ignored_dir(&name) {
                continue;
            }
            let Ok(metadata) = item.metadata() else {
                continue;
            };
            let path = dir.join(&name);
            // A folder the server cannot enter is a deployment permission
            // problem, not a project file; showing it would only offer actions
            // that fail with EACCES.
            if metadata.is_dir() && fs::read_dir(&path).is_err() {
                continue;
            }
            let Ok(relative_path) = path.strip_prefix(root) else {
                continue;
            };
            entries.push(FileEntry {
                name,
                path: relative_path.to_string_lossy().replace('\\', "/"),
                dir: metadata.is_dir(),
                size: metadata.len() as i64,
                mod_time: modified(&metadata),
            });
        }
        entries.sort_by(|a, b| {
            b.dir
                .cmp(&a.dir)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        Ok(entries)
    }

    pub fn read(&self, root: &Path, relative: &str) -> AppResult<FileContent> {
        let path = resolve_existing(root, relative)?;
        let metadata = fs::metadata(&path)?;
        if metadata.is_dir() {
            return Err(crate::errors::bad_request(format!(
                "{relative:?} is a directory"
            )));
        }
        if metadata.len() > MAX_READ_SIZE {
            return Err(AppError::TooLarge);
        }
        let data = fs::read(&path)?;
        if data.iter().take(8192).any(|byte| *byte == 0) {
            return Err(AppError::Binary);
        }
        let relative_path = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        Ok(FileContent {
            path: relative_path,
            content: String::from_utf8_lossy(&data).to_string(),
            hash: crate::crypto::sha256_hex(&data),
            mod_time: modified(&metadata),
            size: metadata.len() as i64,
        })
    }

    pub fn move_path(&self, root: &Path, from: &str, to: &str) -> AppResult<()> {
        let source = resolve_existing(root, from)?;
        let destination = resolve_for_write(root, to)?;
        if source == destination {
            return Ok(());
        }
        if destination.exists() {
            return Err(AppError::Conflict);
        }
        if source.is_dir() && destination.starts_with(&source) {
            return Err(AppError::BadRequest(
                "cannot move a folder into itself".into(),
            ));
        }
        fs::rename(&source, &destination)?;
        Ok(())
    }

    pub fn delete(&self, root: &Path, relative: &str) -> AppResult<()> {
        let path = resolve_for_write(root, relative)?;
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                AppError::NotFound
            } else {
                AppError::Io(error)
            }
        })?;
        if metadata.is_dir() {
            fs::remove_dir_all(&path)?;
        } else {
            fs::remove_file(&path)?;
        }
        Ok(())
    }

    pub fn write(
        &self,
        root: &Path,
        relative: &str,
        content: &str,
        base_hash: &str,
    ) -> AppResult<FileContent> {
        let path = resolve_for_write(root, relative)?;
        if let Ok(metadata) = fs::metadata(&path) {
            if metadata.is_dir() {
                return Err(crate::errors::bad_request(format!(
                    "{relative:?} is a directory"
                )));
            }
            if !base_hash.is_empty() {
                let current = fs::read(&path)?;
                if crate::crypto::sha256_hex(&current) != base_hash {
                    return Err(AppError::FileConflict);
                }
            }
        }
        let parent = path.parent().ok_or(AppError::Forbidden)?;
        let permissions = fs::metadata(&path)
            .map(|metadata| metadata.permissions())
            .or_else(|_| {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    Ok::<std::fs::Permissions, std::io::Error>(std::fs::Permissions::from_mode(
                        0o644,
                    ))
                }
                #[cfg(not(unix))]
                {
                    fs::metadata(parent).map(|metadata| metadata.permissions())
                }
            })?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".jeff-")
            .tempfile_in(parent)?;
        temporary.as_file().set_permissions(permissions)?;
        temporary.write_all(content.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&path)
            .map_err(|error| AppError::Io(error.error))?;
        self.read(root, relative)
    }

    pub fn create_dir(&self, root: &Path, relative: &str) -> AppResult<()> {
        let path = resolve_for_write(root, relative)?;
        fs::create_dir_all(path)?;
        Ok(())
    }

    pub fn write_bytes(&self, root: &Path, relative: &str, content: &[u8]) -> AppResult<i64> {
        let path = resolve_for_write(root, relative)?;
        let parent = path.parent().ok_or(AppError::Forbidden)?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".jeff-")
            .tempfile_in(parent)?;
        temporary.write_all(content)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(&path)
            .map_err(|error| AppError::Io(error.error))?;
        Ok(content.len() as i64)
    }

    /// Resolves a file for streaming downloads without loading it into memory.
    pub fn resolve_file(&self, root: &Path, relative: &str) -> AppResult<(PathBuf, u64)> {
        let path = resolve_existing(root, relative)?;
        let metadata = fs::metadata(&path)?;
        if metadata.is_dir() {
            return Err(AppError::BadRequest("path is a directory".into()));
        }
        Ok((path, metadata.len()))
    }

    pub async fn git_history(&self, root: &Path, path: &str) -> AppResult<Vec<GitHistoryEntry>> {
        let path = if path.trim().is_empty() || path == "." {
            ".".to_string()
        } else {
            validate_git_path(path)?
        };
        let is_directory = root.join(&path).is_dir();
        let mut args = vec!["log"];
        if !is_directory {
            args.push("--follow");
        }
        args.extend([
            "-n",
            "80",
            "--format=%H%x1f%an%x1f%aI%x1f%s",
            "--",
            path.as_str(),
        ]);
        let output = git_output(root, &args).await?;
        Ok(output
            .lines()
            .filter_map(|line| {
                let mut fields = line.splitn(4, '\u{1f}');
                Some(GitHistoryEntry {
                    hash: fields.next()?.to_string(),
                    author: fields.next()?.to_string(),
                    date: fields.next()?.to_string(),
                    subject: fields.next()?.to_string(),
                })
            })
            .collect())
    }

    pub async fn search(
        &self,
        root: &Path,
        query: &str,
        max_results: usize,
    ) -> AppResult<Vec<SearchMatch>> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let max_results = if max_results == 0 || max_results > 500 {
            100
        } else {
            max_results
        };
        let root = root.to_path_buf();
        let query = query.to_string();
        tokio::task::spawn_blocking(move || search_blocking(&root, &query, max_results))
            .await
            .map_err(|error| crate::errors::internal(error.to_string()))?
    }

    pub fn files(&self, root: &Path, query: &str, limit: usize) -> AppResult<Vec<String>> {
        let limit = if limit == 0 || limit > 200 { 80 } else { limit };
        let needle = query.trim().to_lowercase();
        let match_all = needle.is_empty()
            || needle == "*"
            || needle == "**"
            || needle == "**/*"
            || needle == ".";
        let mut files = Vec::new();
        for entry in WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                entry.depth() == 0
                    || !entry.file_type().is_dir()
                    || !ignored_dir(&entry.file_name().to_string_lossy())
            })
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/");
            if !match_all && !relative.to_lowercase().contains(&needle) {
                continue;
            }
            files.push(relative);
            if files.len() >= limit {
                break;
            }
        }
        files.sort();
        Ok(files)
    }

    /// Creates a new folder under a workspace root and, optionally, turns it
    /// into a Git repository, so a project can start from an empty folder
    /// without leaving the app.
    pub async fn create_repo(
        &self,
        parent: &str,
        name: &str,
        init_git: bool,
    ) -> AppResult<Repository> {
        let parent = self.validate_root(Path::new(parent))?;
        let name = validate_repo_name(name)?;
        let path = parent.join(&name);
        if path.exists() {
            return Err(AppError::Conflict);
        }
        fs::create_dir(&path)?;
        if let Ok(mut cache) = self.repos_cache.write() {
            *cache = None;
        }
        if init_git {
            if let Err(error) = git_output(&path, &["init"]).await {
                // A half-created folder would block the retry with a conflict.
                let _ = fs::remove_dir_all(&path);
                return Err(error);
            }
        }
        Ok(Repository {
            relative: name.clone(),
            name,
            path: path.to_string_lossy().to_string(),
            root: parent.to_string_lossy().to_string(),
        })
    }

    pub fn find_repos(&self, query: &str, limit: usize) -> Vec<Repository> {
        let limit = if limit == 0 || limit > 500 {
            200
        } else {
            limit
        };
        let needle = query.trim().to_lowercase();
        let all = self.all_repos();
        all.into_iter()
            .filter(|repo| {
                if needle.is_empty() {
                    return true;
                }
                format!("{} {} {}", repo.name, repo.relative, repo.path)
                    .to_lowercase()
                    .contains(&needle)
            })
            .take(limit)
            .collect()
    }

    /// The workspace tree changes rarely, but walking it takes seconds. Keep
    /// the repo list for a minute so opening the picker is instant after the
    /// first scan.
    fn all_repos(&self) -> Vec<Repository> {
        if let Ok(cache) = self.repos_cache.read() {
            if let Some((at, repos)) = cache.as_ref() {
                if at.elapsed() < std::time::Duration::from_secs(300) {
                    return repos.clone();
                }
            }
        }
        let repos = self.scan_repos();
        if let Ok(mut cache) = self.repos_cache.write() {
            *cache = Some((std::time::Instant::now(), repos.clone()));
        }
        repos
    }

    fn scan_repos(&self) -> Vec<Repository> {
        let mut seen = std::collections::HashSet::new();
        let mut repos = Vec::new();
        for root in self.roots() {
            for entry in WalkDir::new(&root)
                .follow_links(false)
                .max_depth(5)
                .into_iter()
                .filter_entry(|entry| {
                    entry.depth() == 0
                        || !entry.file_type().is_dir()
                        || !ignored_dir(&entry.file_name().to_string_lossy())
                })
                .filter_map(Result::ok)
            {
                if !entry.file_type().is_dir() || entry.path() == root {
                    continue;
                }
                if !entry.path().join(".git").exists() {
                    continue;
                }
                let path = entry.path().to_path_buf();
                if !seen.insert(path.clone()) {
                    continue;
                }
                let relative = path
                    .strip_prefix(&root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                let name = path
                    .file_name()
                    .map(|value| value.to_string_lossy().to_string())
                    .unwrap_or_else(|| relative.clone());
                repos.push(Repository {
                    name,
                    path: path.to_string_lossy().to_string(),
                    root: root.to_string_lossy().to_string(),
                    relative,
                });
            }
        }
        repos.sort_by(|a, b| a.relative.cmp(&b.relative));
        repos
    }

    pub async fn git_status(&self, root: &Path) -> String {
        git_output(root, &["status", "--porcelain=v1", "-b"])
            .await
            .unwrap_or_default()
    }

    /// Repository state that porcelain status alone cannot express: an
    /// in-progress merge/rebase, unresolved paths and the upstream distance.
    pub async fn git_state(&self, root: &Path) -> Value {
        let git_dir = git_output(root, &["rev-parse", "--absolute-git-dir"])
            .await
            .unwrap_or_default()
            .trim()
            .to_string();
        let exists = |name: &str| !git_dir.is_empty() && Path::new(&git_dir).join(name).exists();
        let merging = exists("MERGE_HEAD");
        let rebasing = exists("rebase-merge") || exists("rebase-apply");
        let conflicts = git_output(root, &["diff", "--name-only", "--diff-filter=U"])
            .await
            .unwrap_or_default()
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        let (ahead, behind) = git_output(
            root,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )
        .await
        .ok()
        .and_then(|out| {
            let mut parts = out.split_whitespace();
            Some((
                parts.next()?.parse::<i64>().ok()?,
                parts.next()?.parse::<i64>().ok()?,
            ))
        })
        .unwrap_or((0, 0));
        json!({
            "merging": merging,
            "rebasing": rebasing,
            "conflicts": conflicts,
            "ahead": ahead,
            "behind": behind,
        })
    }

    pub async fn git_merge_continue(&self, root: &Path) -> AppResult<String> {
        let state = self.git_state(root).await;
        if state["conflicts"]
            .as_array()
            .map(|items| !items.is_empty())
            .unwrap_or(false)
        {
            return Err(bad_request(
                "Resolva e prepare os conflitos antes de continuar o merge.",
            ));
        }
        git_output(root, &["commit", "--no-edit"]).await
    }

    pub async fn git_merge_abort(&self, root: &Path) -> AppResult<String> {
        git_output(root, &["merge", "--abort"]).await
    }

    pub async fn git_branches(&self, root: &Path) -> AppResult<GitBranches> {
        let current = git_output(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await
            .unwrap_or_default()
            .trim()
            .to_string();
        let output = git_output(root, &["branch", "--format=%(refname:short)"]).await?;
        let branches = output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        Ok(GitBranches { current, branches })
    }

    pub async fn git_stage(&self, root: &Path, paths: &[String]) -> AppResult<()> {
        let paths = validate_git_paths(paths)?;
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        git_checked(root, &args).await
    }

    pub async fn git_unstage(&self, root: &Path, paths: &[String]) -> AppResult<()> {
        let paths = validate_git_paths(paths)?;
        let mut args = vec!["reset", "HEAD", "--"];
        args.extend(paths.iter().map(String::as_str));
        git_checked(root, &args).await
    }

    pub async fn git_commit(&self, root: &Path, message: &str) -> AppResult<String> {
        if message.trim().is_empty() {
            return Err(crate::errors::bad_request("commit message is required"));
        }
        git_output(root, &["commit", "-m", message.trim()]).await
    }

    /// Pushes the current branch. A branch without an upstream is published
    /// with `-u origin`, so the first push from the branch picker just works.
    pub async fn git_push(&self, root: &Path, git_token: Option<&str>) -> AppResult<String> {
        let branch = git_output(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await?
            .trim()
            .to_string();
        if branch.is_empty() || branch == "HEAD" {
            return Err(crate::errors::bad_request(
                "Não há uma branch atual para enviar.",
            ));
        }
        let has_upstream = Command::new("git")
            .args([
                "-C",
                &root.to_string_lossy(),
                "rev-parse",
                "--abbrev-ref",
                "--symbolic-full-name",
                "@{u}",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map(|status| status.success())
            .unwrap_or(false);
        let args = if has_upstream {
            vec!["push"]
        } else {
            vec!["push", "-u", "origin", branch.as_str()]
        };
        match git_token.filter(|token| !token.is_empty()) {
            Some(token) => {
                git_output_env(
                    root,
                    &args,
                    &[
                        ("JEFF_GIT_TOKEN", token),
                        (
                            "JEFF_GIT_CREDENTIAL_URL",
                            "http://127.0.0.1:8787/api/git/credential",
                        ),
                    ],
                )
                .await
            }
            None => git_output(root, &args).await,
        }
    }

    pub async fn git_diff(&self, root: &Path, path: &str, staged: bool) -> AppResult<String> {
        let path = validate_git_path(path)?;
        let mut args = vec!["diff", "--no-color"];
        if staged {
            args.push("--cached");
        }
        args.extend(["--", path.as_str()]);
        match git_output(root, &args).await {
            Ok(output) => Ok(output),
            Err(_) if !staged => {
                let full = root.join(&path);
                match fs::read_to_string(full) {
                    Ok(content) => Ok(format!("--- /dev/null\n+++ b/{path}\n{content}")),
                    Err(_) => Ok(String::new()),
                }
            }
            Err(error) => Err(error),
        }
    }

    pub async fn git_file_versions(
        &self,
        root: &Path,
        path: &str,
        staged: bool,
    ) -> AppResult<(String, String)> {
        let path = validate_git_path(path)?;
        let original = if staged {
            git_show(root, &format!("HEAD:{path}")).await
        } else {
            git_show(root, &format!(":{path}")).await
        };
        let modified = if staged {
            git_show(root, &format!(":{path}")).await
        } else {
            fs::read_to_string(root.join(&path)).unwrap_or_default()
        };
        Ok((original, modified))
    }

    pub async fn git_blame(&self, root: &Path, path: &str) -> AppResult<Vec<GitBlameLine>> {
        let path = validate_git_path(path)?;
        let output = git_output(root, &["blame", "--line-porcelain", "--", &path]).await?;
        let mut lines = Vec::new();
        let mut current = GitBlameLine {
            line: 0,
            commit: String::new(),
            author: String::new(),
            author_time: String::new(),
            summary: String::new(),
        };
        let mut line_no = 0usize;
        for line in output.lines() {
            if let Some(content) = line.strip_prefix('\t') {
                let _ = content;
                current.line = line_no;
                if current.author.is_empty() {
                    current.author = "Unknown".into();
                }
                lines.push(current.clone());
                continue;
            }
            let fields: Vec<&str> = line.split_whitespace().collect();
            if fields.len() >= 3
                && fields[0].len() >= 7
                && fields[0].chars().all(|c| c.is_ascii_hexdigit())
            {
                current = GitBlameLine {
                    line: 0,
                    commit: fields[0].to_string(),
                    author: String::new(),
                    author_time: String::new(),
                    summary: String::new(),
                };
                line_no = fields[2].parse().unwrap_or(0);
            } else if let Some(author) = line.strip_prefix("author ") {
                current.author = author.into();
            } else if let Some(seconds) = line.strip_prefix("author-time ") {
                if let Ok(seconds) = seconds.parse::<i64>() {
                    current.author_time = DateTime::<Utc>::from_timestamp(seconds, 0)
                        .map(|time| time.to_rfc3339())
                        .unwrap_or_default();
                }
            } else if let Some(summary) = line.strip_prefix("summary ") {
                current.summary = summary.into();
            }
        }
        Ok(lines)
    }

    pub async fn git_checkout(&self, root: &Path, name: &str) -> AppResult<()> {
        validate_branch_name(name)?;
        git_checked(root, &["switch", name]).await
    }

    /** Delete every local branch except the one currently checked out. */
    pub async fn git_delete_other_branches(&self, root: &Path) -> AppResult<usize> {
        let current = git_output(root, &["rev-parse", "--abbrev-ref", "HEAD"])
            .await?
            .trim()
            .to_string();
        let output = git_output(root, &["branch", "--format=%(refname:short)"]).await?;
        let names: Vec<String> = output
            .lines()
            .map(str::trim)
            .filter(|name| !name.is_empty() && *name != current && *name != "HEAD")
            .map(ToOwned::to_owned)
            .collect();
        if names.is_empty() {
            return Ok(0);
        }
        let mut args = vec!["branch", "-D"];
        args.extend(names.iter().map(String::as_str));
        git_checked(root, &args).await?;
        Ok(names.len())
    }

    pub async fn git_create_branch(&self, root: &Path, name: &str) -> AppResult<String> {
        validate_branch_name(name)?;
        git_checked(root, &["check-ref-format", "--branch", name]).await?;
        git_checked(root, &["switch", "-c", name]).await?;
        Ok(name.into())
    }

    pub async fn git_discard(&self, root: &Path, paths: &[String], staged: bool) -> AppResult<()> {
        let paths = validate_git_paths(paths)?;
        for path in paths {
            let tracked = Command::new("git")
                .args([
                    "-C",
                    &root.to_string_lossy(),
                    "ls-files",
                    "--error-unmatch",
                    "--",
                    &path,
                ])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await
                .map(|status| status.success())
                .unwrap_or(false);
            if !tracked {
                // `git status --porcelain` collapses untracked directories, so
                // `path` can be a folder. `git clean` handles both files and
                // directories, and unlike remove_file it reports failures.
                git_checked(root, &["clean", "-fd", "--", path.as_str()]).await?;
                continue;
            }
            // A file newly added to the index has no HEAD version, so
            // `git restore --staged` cannot undo it: unstage it first and then
            // clean the file (or directory) from disk.
            let added = git_output(
                root,
                &[
                    "diff",
                    "--cached",
                    "--name-status",
                    "--diff-filter=A",
                    "--",
                    path.as_str(),
                ],
            )
            .await
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false);
            if staged && added {
                git_checked(root, &["rm", "--cached", "-f", "--", path.as_str()]).await?;
                git_checked(root, &["clean", "-fd", "--", path.as_str()]).await?;
                continue;
            }
            let mut args = vec!["restore"];
            if staged {
                args.extend(["--staged", "--worktree"]);
            } else {
                args.push("--worktree");
            }
            args.extend(["--", path.as_str()]);
            git_checked(root, &args).await?;
        }
        Ok(())
    }
}

fn resolve_roots(roots: &[PathBuf]) -> AppResult<Vec<PathBuf>> {
    roots.iter().map(|root| resolve_root(root)).collect()
}

fn resolve_root(root: &Path) -> AppResult<PathBuf> {
    let absolute = if root.is_absolute() {
        root.to_path_buf()
    } else {
        std::env::current_dir()?.join(root)
    };
    let real = absolute.canonicalize()?;
    if !real.is_dir() {
        return Err(crate::errors::bad_request(format!(
            "workspace root {} is not a directory",
            root.display()
        )));
    }
    Ok(real)
}

fn safe_relative(relative: &str) -> AppResult<PathBuf> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::Prefix(_)))
    {
        return Err(AppError::Forbidden);
    }
    let mut clean = PathBuf::new();
    for component in path.components() {
        if let Component::Normal(value) = component {
            clean.push(value);
        }
    }
    Ok(clean)
}

fn resolve_existing(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let relative = safe_relative(relative)?;
    let path = root.join(relative);
    let real = path.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            AppError::NotFound
        } else {
            AppError::Io(error)
        }
    })?;
    if real != root && !real.starts_with(&root) {
        return Err(AppError::Forbidden);
    }
    Ok(real)
}

fn resolve_for_write(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let root = root.canonicalize()?;
    let relative = safe_relative(relative)?;
    if relative.as_os_str().is_empty() {
        return Err(AppError::Forbidden);
    }
    let path = root.join(relative);
    let parent = path.parent().ok_or(AppError::Forbidden)?;
    let real_parent = parent.canonicalize()?;
    if real_parent != root && !real_parent.starts_with(&root) {
        return Err(AppError::Forbidden);
    }
    Ok(path)
}

fn modified(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .ok()
        .map(DateTime::<Utc>::from)
        .map(|time| time.to_rfc3339())
        .unwrap_or_default()
}

fn search_blocking(root: &Path, query: &str, max_results: usize) -> AppResult<Vec<SearchMatch>> {
    if let Ok(output) = std::process::Command::new("rg")
        .args([
            "-n",
            "--no-heading",
            "--color",
            "never",
            "--hidden",
            "--glob",
            "!.git/**",
            "--glob",
            "!**/.git/**",
            "--glob",
            "!node_modules/**",
            "--glob",
            "!**/node_modules/**",
            "--glob",
            "!dist/**",
            "--glob",
            "!**/dist/**",
            "--glob",
            "!build/**",
            "--glob",
            "!**/build/**",
            "--glob",
            "!target/**",
            "--glob",
            "!**/target/**",
            "--max-count",
            "20",
            "--",
            query,
        ])
        .current_dir(root)
        .output()
    {
        if output.status.success() {
            let mut matches = Vec::new();
            for line in String::from_utf8_lossy(&output.stdout).lines() {
                if matches.len() >= max_results {
                    break;
                }
                let mut parts = line.splitn(3, ':');
                let Some(path) = parts.next() else { continue };
                let Some(line_no) = parts.next() else {
                    continue;
                };
                let Some(preview) = parts.next() else {
                    continue;
                };
                matches.push(SearchMatch {
                    path: path.replace('\\', "/"),
                    line: line_no.parse().unwrap_or(0),
                    column: 0,
                    preview: preview.trim().to_string(),
                });
            }
            return Ok(matches);
        }
    }
    let needle = query.to_lowercase();
    let mut matches = Vec::new();
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_dir()
                || !ignored_dir(&entry.file_name().to_string_lossy())
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.len() > 1024 * 1024 {
            continue;
        }
        let Ok(content) = fs::read_to_string(entry.path()) else {
            continue;
        };
        for (index, line) in content.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                let relative = entry
                    .path()
                    .strip_prefix(root)
                    .unwrap_or(entry.path())
                    .to_string_lossy()
                    .replace('\\', "/");
                matches.push(SearchMatch {
                    path: relative,
                    line: index + 1,
                    column: 0,
                    preview: line.trim().to_string(),
                });
                if matches.len() >= max_results {
                    return Ok(matches);
                }
            }
        }
    }
    Ok(matches)
}

/// A new repository is one folder directly under a workspace root: a single
/// path segment, never a dotted name (`.git`, `..`) and no separators.
fn validate_repo_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(crate::errors::bad_request("informe um nome para a pasta"));
    }
    let clean =
        safe_relative(name).map_err(|_| crate::errors::bad_request("nome de pasta inválido"))?;
    let mut components = clean.components();
    let (Some(Component::Normal(value)), None) = (components.next(), components.next()) else {
        return Err(crate::errors::bad_request(
            "o nome deve ser uma única pasta, sem barras",
        ));
    };
    let value = value.to_string_lossy().to_string();
    if value.starts_with('.') || value.chars().any(char::is_control) {
        return Err(crate::errors::bad_request("nome de pasta inválido"));
    }
    if value.len() > 64 {
        return Err(crate::errors::bad_request("o nome da pasta é longo demais"));
    }
    Ok(value)
}

fn validate_git_path(path: &str) -> AppResult<String> {
    let clean = safe_relative(path)?;
    if clean.as_os_str().is_empty() {
        return Err(AppError::Forbidden);
    }
    Ok(clean.to_string_lossy().replace('\\', "/"))
}

fn validate_git_paths(paths: &[String]) -> AppResult<Vec<String>> {
    if paths.is_empty() {
        return Err(crate::errors::bad_request("no paths provided"));
    }
    paths.iter().map(|path| validate_git_path(path)).collect()
}

fn validate_branch_name(name: &str) -> AppResult<()> {
    let name = name.trim();
    if name.is_empty() || name.starts_with('-') || name.chars().any(|c| c.is_whitespace()) {
        return Err(crate::errors::bad_request("invalid branch name"));
    }
    Ok(())
}

async fn git_output(root: &Path, args: &[&str]) -> AppResult<String> {
    git_output_env(root, args, &[]).await
}

async fn git_output_env(root: &Path, args: &[&str], envs: &[(&str, &str)]) -> AppResult<String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(root).args(args);
    for (key, value) in envs {
        command.env(key, value);
    }
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = command.output().await?;
    if !output.status.success() {
        return Err(crate::errors::bad_request(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

async fn git_checked(root: &Path, args: &[&str]) -> AppResult<()> {
    git_output(root, args).await.map(|_| ())
}

async fn git_show(root: &Path, spec: &str) -> String {
    git_output(root, &["show", spec]).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_files_treats_glob_star_as_match_all() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.txt"), "x").unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        std::fs::write(dir.path().join("src/b.ts"), "y").unwrap();
        let service = WorkspaceService::new(vec![dir.path().to_path_buf()]).unwrap();
        let files = service.files(dir.path(), "*", 100).unwrap();
        assert!(files.contains(&"a.txt".to_string()));
        assert!(files.contains(&"src/b.ts".to_string()));
    }

    #[tokio::test]
    async fn create_repo_makes_a_folder_under_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let service = WorkspaceService::new(vec![dir.path().to_path_buf()]).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let repo = service
            .create_repo(&root, "  novo-projeto  ", false)
            .await
            .unwrap();
        assert_eq!(repo.name, "novo-projeto");
        assert_eq!(repo.relative, "novo-projeto");
        assert!(dir.path().join("novo-projeto").is_dir());
        assert!(!dir.path().join("novo-projeto/.git").exists());
        // The same name cannot be created twice.
        assert!(matches!(
            service.create_repo(&root, "novo-projeto", false).await,
            Err(AppError::Conflict)
        ));
    }

    #[tokio::test]
    async fn create_repo_rejects_names_that_are_not_one_folder() {
        let dir = tempfile::tempdir().unwrap();
        let service = WorkspaceService::new(vec![dir.path().to_path_buf()]).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        for name in ["", "  ", ".", "..", ".git", "a/b", "../fora", "/abs"] {
            assert!(
                service.create_repo(&root, name, false).await.is_err(),
                "{name:?} should be rejected"
            );
        }
        assert!(!dir.path().join("fora").exists());
    }

    #[tokio::test]
    async fn create_repo_initializes_git_when_asked() {
        let dir = tempfile::tempdir().unwrap();
        let service = WorkspaceService::new(vec![dir.path().to_path_buf()]).unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let repo = service.create_repo(&root, "com-git", true).await.unwrap();
        assert!(std::path::Path::new(&repo.path).join(".git").is_dir());
    }

    #[tokio::test]
    async fn git_discard_removes_an_untracked_directory() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git_checked(root, &["init", "-q"]).await.unwrap();
        std::fs::create_dir_all(root.join("docs/architecture")).unwrap();
        std::fs::write(root.join("docs/architecture/README.md"), "draft").unwrap();
        let service = WorkspaceService::new(vec![root.to_path_buf()]).unwrap();
        service
            .git_discard(root, &["docs/architecture/".to_string()], false)
            .await
            .unwrap();
        assert!(!root.join("docs/architecture").exists());
    }

    #[tokio::test]
    async fn git_push_publishes_the_current_branch_to_origin() {
        let work = tempfile::tempdir().unwrap();
        let remote = tempfile::tempdir().unwrap();
        git_checked(work.path(), &["init", "-q", "-b", "main"])
            .await
            .unwrap();
        git_checked(remote.path(), &["init", "-q", "--bare"])
            .await
            .unwrap();
        std::fs::write(work.path().join("a.txt"), "x").unwrap();
        git_checked(work.path(), &["add", "--", "a.txt"])
            .await
            .unwrap();
        git_checked(
            work.path(),
            &[
                "-c",
                "user.email=jeff@example.com",
                "-c",
                "user.name=Jeff",
                "commit",
                "-m",
                "first",
            ],
        )
        .await
        .unwrap();
        let remote_path = remote.path().to_string_lossy().to_string();
        git_checked(work.path(), &["remote", "add", "origin", &remote_path])
            .await
            .unwrap();
        let service = WorkspaceService::new(vec![work.path().to_path_buf()]).unwrap();
        service.git_push(work.path(), None).await.unwrap();
        assert!(remote.path().join("refs/heads/main").exists());
    }

    #[tokio::test]
    async fn git_discard_removes_a_newly_staged_file() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        git_checked(root, &["init", "-q"]).await.unwrap();
        std::fs::write(root.join("novo.txt"), "draft").unwrap();
        git_checked(root, &["add", "--", "novo.txt"]).await.unwrap();
        let service = WorkspaceService::new(vec![root.to_path_buf()]).unwrap();
        service
            .git_discard(root, &["novo.txt".to_string()], true)
            .await
            .unwrap();
        assert!(!root.join("novo.txt").exists());
        let staged = git_output(root, &["diff", "--cached", "--name-only"])
            .await
            .unwrap();
        assert!(staged.trim().is_empty());
    }
}
