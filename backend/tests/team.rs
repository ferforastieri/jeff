use std::path::PathBuf;
use std::time::Duration;

use jeff_server::config::Config;
use serde_json::Value;

#[tokio::test]
async fn invite_project_visibility_and_onboarding() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let config = Config::local(
        dir.path().join("data"),
        PathBuf::from(&workspace),
        "secret".into(),
        "127.0.0.1:0".into(),
    );
    let server = jeff_server::start_embedded(config).await.unwrap();
    let base = format!("http://{}", server.addr);

    let admin = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let login: Value = admin
        .post(format!("{base}/api/auth/login"))
        .json(&serde_json::json!({"username":"admin","password":"secret","kind":"web"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let csrf = login["csrfToken"].as_str().unwrap().to_string();

    let projects: Vec<Value> = admin
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let project_id = projects[0]["id"].as_str().unwrap().to_string();

    // The first configuration is still pending and the default project exists.
    let status: Value = admin
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["done"], false);
    assert_eq!(status["needsProject"], false);
    assert_eq!(status["isAdmin"], true);

    // Invite a member and accept it from a separate session.
    let invite: Value = admin
        .post(format!("{base}/api/invites"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({"role":"member","days":7}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let token = invite["token"].as_str().unwrap().to_string();

    let member = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let info: Value = member
        .get(format!("{base}/api/auth/invite/{token}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["valid"], true);
    assert_eq!(info["role"], "member");

    let accepted: Value = member
        .post(format!("{base}/api/auth/invite/{token}"))
        .json(&serde_json::json!({
            "username": "ana",
            "password": "senha-forte",
            "displayName": "Ana"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let member_id = accepted["user"]["id"].as_i64().unwrap();
    assert_eq!(accepted["user"]["role"], "member");

    // A member sees no project until the admin grants one.
    let visible: Vec<Value> = member
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(visible.is_empty());
    let denied = member
        .get(format!("{base}/api/projects/{project_id}/tree?path="))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), 403);

    admin
        .post(format!("{base}/api/projects/{project_id}/members"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({ "userId": member_id }))
        .send()
        .await
        .unwrap();
    let visible: Vec<Value> = member
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(visible.len(), 1);
    let allowed = member
        .get(format!("{base}/api/projects/{project_id}/tree?path="))
        .send()
        .await
        .unwrap();
    assert_eq!(allowed.status(), 200);

    // A member cannot invite or change the team.
    let refused = member
        .post(format!("{base}/api/invites"))
        .header("X-Jeff-CSRF", accepted["csrfToken"].as_str().unwrap_or(""))
        .json(&serde_json::json!({"role":"admin"}))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 403);

    // Onboarding creates the config agent, its direct conversation and Geral.
    let done: Value = admin
        .post(format!("{base}/api/onboarding"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "mode": "solo",
            "activity": "dev",
            "objective": "organizar o trabalho",
            "tools": "VS Code, terminal",
            "agentName": "Nico",
            "projectId": project_id
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(done["ok"], true);
    assert!(done["agentId"].as_str().is_some());
    assert!(done["dmRoomId"].as_str().is_some());
    assert!(done["invite"].is_null());

    let again = admin
        .post(format!("{base}/api/onboarding"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "mode": "solo",
            "agentName": "Nico",
            "projectId": project_id
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(again.status(), 409);

    let rooms: Value = admin
        .get(format!("{base}/api/projects/{project_id}/rooms"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let rooms = rooms["rooms"].as_array().cloned().unwrap_or_default();
    assert!(rooms.iter().any(|room| room["name"] == "Geral"));
    assert!(rooms.iter().any(|room| room["kind"] == "dm"));
}
