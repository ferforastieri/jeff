use std::path::PathBuf;
use std::time::Duration;

use jeff_server::config::Config;
use serde_json::Value;

#[tokio::test]
async fn members_channels_and_dev_access() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    let config = Config::local(
        dir.path().join("data"),
        PathBuf::from(&workspace),
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
        .post(format!("{base}/api/auth/register"))
        .json(&serde_json::json!({
            "email": "admin@example.com",
            "name": "Admin",
            "password": "secret123",
            "kind": "web"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let csrf = login["csrfToken"].as_str().unwrap().to_string();

    let status: Value = admin
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let workspace_project = status["projectId"].as_str().unwrap().to_string();
    assert_eq!(status["done"], false);
    assert_eq!(status["isAdmin"], true);
    assert_eq!(status["devMode"], true);

    // The silent workspace project never appears as a dev repo.
    let projects: Vec<Value> = admin
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(projects.is_empty());

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
    assert_eq!(accepted["user"]["devAccess"], false);

    // A member starts with no visible channels and no dev access.
    let visible: Value = member
        .get(format!("{base}/api/channels"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(visible["rooms"].as_array().unwrap().is_empty());
    let member_status: Value = member
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(member_status["devMode"], false);

    // Admin creates a channel; the member still cannot see it.
    let channel: Value = admin
        .post(format!("{base}/api/channels"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({"name":"Vendas"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let channel_id = channel["id"].as_str().unwrap().to_string();
    assert_eq!(channel["name"], "Vendas");

    let visible: Value = member
        .get(format!("{base}/api/channels"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(visible["rooms"].as_array().unwrap().is_empty());

    // Granting the channel is per member.
    let granted = admin
        .put(format!("{base}/api/channels/{channel_id}/access"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({"userId": member_id, "allowed": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(granted.status(), 200);
    let visible: Value = member
        .get(format!("{base}/api/channels"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(visible["rooms"].as_array().unwrap().len(), 1);

    // Dev access is also per member.
    let dev_granted = admin
        .patch(format!("{base}/api/team/{member_id}"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({"devAccess": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(dev_granted.status(), 200);
    let member_status: Value = member
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(member_status["devMode"], true);

    // A member cannot invite, change the team, or create channels.
    let refused = member
        .post(format!("{base}/api/invites"))
        .header("X-Jeff-CSRF", accepted["csrfToken"].as_str().unwrap_or(""))
        .json(&serde_json::json!({"role":"admin"}))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 403);
    let refused_channel = member
        .post(format!("{base}/api/channels"))
        .header("X-Jeff-CSRF", accepted["csrfToken"].as_str().unwrap_or(""))
        .json(&serde_json::json!({"name":"Nao"}))
        .send()
        .await
        .unwrap();
    assert_eq!(refused_channel.status(), 403);

    // A time zone outside the IANA database is refused before anything is written.
    let invalid = admin
        .post(format!("{base}/api/onboarding"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "agentName": "Nico",
            "timezone": "Mars/Olympus"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(invalid.status(), 400);

    // Onboarding creates the config agent, its direct conversation and Geral.
    let done: Value = admin
        .post(format!("{base}/api/onboarding"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "activity": "dev",
            "objective": "organizar o trabalho",
            "tools": "VS Code, terminal",
            "agentName": "Nico",
            "teamName": "Time do teste",
            "timezone": "Europe/Lisbon",
            "avatar": {"kind": "person", "recipe": {"skin": "s2"}},
            "workspaceLogo": "data:image/png;base64,abc"
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
    assert!(done["invite"]["token"].as_str().is_some());

    // The workspace name and time zone are persisted and reported back.
    let after: Value = admin
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after["teamName"], "Time do teste");
    assert_eq!(after["timezone"], "Europe/Lisbon");
    assert_eq!(after["workspaceLogo"], "data:image/png;base64,abc");
    assert_eq!(after["workspaceState"]["projectId"], workspace_project);
    assert_eq!(after["workspaceState"]["roomId"], done["dmRoomId"]);

    // The profile avatar rides on the human principal.
    let principals: Value = admin
        .get(format!("{base}/api/principals"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(principals["me"]["avatar"]["kind"], "person");
    assert_eq!(principals["me"]["avatar"]["recipe"]["skin"], "s2");

    let again = admin
        .post(format!("{base}/api/onboarding"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "agentName": "Nico"
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(again.status(), 409);

    let rooms: Value = admin
        .get(format!("{base}/api/channels"))
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
