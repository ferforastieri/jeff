use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OpenProjectsRequest {
    #[serde(default)]
    open_project_ids: Vec<String>,
}

pub(super) async fn get_open_projects(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let key = format!("open_projects:{}", context.user.id);
    let raw = state.store.setting(&key).await.unwrap_or_default();
    let saved: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();
    let workspace = state
        .store
        .workspace_project()
        .await
        .map(|project| project.id)
        .unwrap_or_default();
    let projects = state.store.list_projects().await?;
    let open: Vec<String> = saved
        .into_iter()
        .filter(|id| *id != workspace && projects.iter().any(|project| project.id == *id))
        .collect();
    Ok(Json(json!({ "openProjectIds": open })))
}

pub(super) async fn save_open_projects(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
    Json(input): Json<OpenProjectsRequest>,
) -> AppResult<Json<Value>> {
    let workspace = state
        .store
        .workspace_project()
        .await
        .map(|project| project.id)
        .unwrap_or_default();
    let projects = state.store.list_projects().await?;
    let mut open: Vec<String> = Vec::new();
    for id in input.open_project_ids {
        let id = id.trim().to_string();
        if !id.is_empty()
            && id != workspace
            && !open.contains(&id)
            && projects.iter().any(|project| project.id == id)
        {
            open.push(id);
        }
    }
    let key = format!("open_projects:{}", context.user.id);
    state
        .store
        .set_setting(&key, &serde_json::to_string(&open)?)
        .await?;
    Ok(Json(json!({ "openProjectIds": open })))
}

#[derive(Deserialize)]
pub(super) struct ProjectRequest {
    name: String,
    root: String,
    #[serde(default)]
    color: String,
}

pub(super) async fn list_projects(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Vec<Project>>> {
    let workspace = state
        .store
        .workspace_project()
        .await
        .map(|project| project.id)
        .unwrap_or_default();
    let projects = state
        .store
        .list_projects_for(auth.user.id, auth.user.is_admin())
        .await?
        .into_iter()
        .filter(|project| project.id != workspace)
        .collect();
    Ok(Json(projects))
}

pub(super) async fn create_project(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<ProjectRequest>,
) -> AppResult<Response> {
    if !auth.user.is_admin() && !auth.user.dev_access {
        return Err(AppError::Forbidden);
    }
    let root = state
        .workspace
        .validate_root(PathBuf::from(&input.root).as_path())?;
    let project = state
        .store
        .create_project(Project {
            id: new_id(),
            name: input.name,
            root: root.to_string_lossy().to_string(),
            color: if input.color.is_empty() {
                "#0063D1".into()
            } else {
                input.color
            },
            created_at: String::new(),
            updated_at: String::new(),
        })
        .await?;
    state
        .store
        .add_project_member(&project.id, auth.user.id)
        .await?;
    state.watch_project(&project.id, &root).await?;
    Ok((StatusCode::CREATED, Json(project)).into_response())
}

pub(super) async fn get_project(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Project>> {
    Ok(Json(state.store.project(&project_id).await?))
}

pub(super) async fn update_project(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
    Json(input): Json<ProjectRequest>,
) -> AppResult<Json<Project>> {
    let mut project = state.store.project(&project_id).await?;
    let previous_root = project.root.clone();
    if !input.root.is_empty() && input.root != project.root {
        let root = state
            .workspace
            .validate_root(PathBuf::from(&input.root).as_path())?;
        project.root = root.to_string_lossy().to_string();
    }
    if !input.name.is_empty() {
        project.name = input.name;
    }
    if !input.color.is_empty() {
        project.color = input.color;
    }
    let updated = state.store.update_project(project).await?;
    if updated.root != previous_root {
        state.watcher.unwatch(&updated.id);
        state
            .watch_project(&updated.id, FsPath::new(&updated.root))
            .await?;
    }
    Ok(Json(updated))
}

pub(super) async fn delete_project(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Value>> {
    state.store.delete_project(&project_id).await?;
    state.watcher.unwatch(&project_id);
    Ok(Json(json!({ "ok": true })))
}
