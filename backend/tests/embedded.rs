use std::path::PathBuf;
use std::time::Duration;

use jeff_server::config::Config;
use serde_json::Value;

#[tokio::test]
async fn embedded_server_serves_authenticated_api() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = dir.path().join("workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    std::fs::write(workspace.join("hello.txt"), "hello\n").unwrap();
    let config = Config::local(
        dir.path().join("data"),
        PathBuf::from(&workspace),
        "127.0.0.1:0".into(),
    );
    let server = jeff_server::start_embedded(config).await.unwrap();
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let base = format!("http://{}", server.addr);

    let health: Value = client
        .get(format!("{base}/api/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["name"], "jeff");

    let login: Value = client
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

    // The workspace project is internal: the product exposes channels, so the
    // projects list is empty and the id comes from the onboarding status.
    let projects: Vec<Value> = client
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(projects.is_empty());
    let status: Value = client
        .get(format!("{base}/api/onboarding"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let project_id = status["projectId"].as_str().unwrap();
    let entries: Vec<Value> = client
        .get(format!("{base}/api/projects/{project_id}/tree?path="))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(entries.iter().any(|entry| entry["name"] == "hello.txt"));

    let messages = (0..45)
        .map(|index| {
            serde_json::json!({
                "id": format!("message-{index:02}"),
                "chatId": "chat-one",
                "role": "assistant",
                "content": format!("answer {index}"),
                "createdAt": index,
            })
        })
        .collect::<Vec<_>>();
    client
        .put(format!("{base}/api/projects/{project_id}/workspace"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "tabs": [],
            "activeTabId": null,
            "chats": {
                "version": 3,
                "chat": {
                    "id": "chat-one",
                    "name": "checkout",
                    "description": "pagamentos",
                    "createdAt": 1,
                    "updatedAt": 1
                },
                "jeffs": []
            }
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let layout: Value = client
        .get(format!("{base}/api/projects/{project_id}/workspace"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(layout["chats"]["chat"]["name"], "checkout");
    client
        .put(format!(
            "{base}/api/projects/{project_id}/workspace/messages"
        ))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({ "messages": messages }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let page: Value = client
        .get(format!(
            "{base}/api/projects/{project_id}/workspace/messages?mode=chat&channel=chat-one&scope=conversation&limit=10"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 10);
    assert_eq!(page["items"][0]["id"], "message-35");
    assert_eq!(page["items"][9]["id"], "message-44");
    assert_eq!(page["hasMore"], true);
    let cursor = &page["nextCursor"];
    let older: Value = client
        .get(format!(
            "{base}/api/projects/{project_id}/workspace/messages?mode=chat&channel=chat-one&scope=conversation&limit=10&beforeAt={}&beforeChannel={}&beforeId={}",
            cursor["createdAt"].as_i64().unwrap(),
            cursor["channel"].as_str().unwrap(),
            cursor["id"].as_str().unwrap(),
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(older["items"][0]["id"], "message-25");
    assert_eq!(older["items"][9]["id"], "message-34");

    client
        .put(format!(
            "{base}/api/projects/{project_id}/workspace/messages"
        ))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "replace": { "mode": "chat", "channel": "chat-one" },
            "messages": [{
                "id": "replacement",
                "chatId": "chat-one",
                "role": "assistant",
                "content": "replacement answer",
                "createdAt": 100,
            }]
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let replaced: Value = client
        .get(format!(
            "{base}/api/projects/{project_id}/workspace/messages?mode=chat&channel=chat-one&scope=conversation&limit=10"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replaced["items"].as_array().unwrap().len(), 1);
    assert_eq!(replaced["items"][0]["id"], "replacement");

    let saved: Value = client
        .put(format!("{base}/api/projects/{project_id}/file"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({"path":"hello.txt","content":"updated\n","baseHash":""}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(saved["content"], "updated\n");

    server.shutdown();
}
