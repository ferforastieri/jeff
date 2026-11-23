use std::path::PathBuf;
use std::time::Duration;

use jeff_server::config::Config;
use serde_json::Value;

#[tokio::test]
async fn room_message_reaches_the_queue_and_reports_a_failure() {
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
    let client = reqwest::Client::builder()
        .cookie_store(true)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let base = format!("http://{}", server.addr);

    let login: Value = client
        .post(format!("{base}/api/auth/login"))
        .json(&serde_json::json!({"username":"admin","password":"secret","kind":"web"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let csrf = login["csrfToken"].as_str().unwrap().to_string();

    let projects: Vec<Value> = client
        .get(format!("{base}/api/projects"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let project = projects[0]["id"].as_str().unwrap().to_string();

    let principals: Value = client
        .get(format!("{base}/api/principals"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(principals["me"]["kind"], "human");

    // An engine the room queue refuses on purpose: the test must never spawn a
    // real CLI or spend model quota.
    let bot: Value = client
        .post(format!("{base}/api/principals"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "name": "Ana",
            "handle": "ana",
            "title": "revisora",
            "persona": "Revise mudanças.",
            "engine": "grok",
            "model": "",
            "effort": ""
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let bot_id = bot["id"].as_str().unwrap().to_string();

    let room: Value = client
        .post(format!("{base}/api/projects/{project}/rooms"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "name": "Geral",
            "title": "Time",
            "instructions": "Fale em português.",
            "leadId": bot_id,
            "memberIds": [bot_id]
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let room_id = room["id"].as_str().unwrap().to_string();
    assert_eq!(room["leadId"], bot_id);

    let sent: Value = client
        .post(format!(
            "{base}/api/projects/{project}/rooms/{room_id}/messages"
        ))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({ "text": "olá" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sent["deliveries"], 1);

    let cards: Value = client
        .get(format!("{base}/api/projects/{project}/cards"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        cards["cards"].as_array().map(Vec::len).unwrap_or(0),
        0,
        "a plain request no longer opens a card; the bot tool does"
    );

    let routine: Value = client
        .post(format!(
            "{base}/api/projects/{project}/rooms/{room_id}/routines"
        ))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "agentId": bot_id,
            "name": "Diário",
            "instruction": "Resuma o que aconteceu.",
            "schedule": { "kind": "daily", "time": "09:00" },
            "timezone": "UTC",
            "active": true
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(routine["name"], "Diário");
    assert!(routine["trigger"]["nextRunAt"].as_i64().is_some());
    let routine_id = routine["id"].as_str().unwrap().to_string();

    let run: Value = client
        .post(format!(
            "{base}/api/projects/{project}/routines/{routine_id}/test"
        ))
        .header("X-Jeff-CSRF", &csrf)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let run_id = run["id"].as_str().unwrap().to_string();

    let mut status = String::new();
    for _ in 0..50 {
        let runs: Value = client
            .get(format!(
                "{base}/api/projects/{project}/routines/{routine_id}/runs"
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if let Some(found) = runs["runs"]
            .as_array()
            .and_then(|items| items.iter().find(|item| item["id"] == run_id))
        {
            status = found["status"].as_str().unwrap_or_default().to_string();
        }
        if status == "failed" || status == "succeeded" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(status, "failed", "the test engine must fail fast, not hang");

    let listed: Value = client
        .get(format!(
            "{base}/api/projects/{project}/rooms/{room_id}/messages"
        ))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let messages = listed["messages"].as_array().cloned().unwrap_or_default();
    assert!(
        messages.iter().any(|message| message["kind"] == "routine"),
        "the routine instruction must appear in the room"
    );

    let cards: Value = client
        .get(format!("{base}/api/projects/{project}/cards"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        cards["cards"].as_array().map(Vec::len).unwrap_or(0),
        1,
        "the routine run opens a card"
    );

    let memory: Value = client
        .post(format!("{base}/api/principals/{bot_id}/memories"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({
            "text": "Prefere respostas curtas.",
            "inclusion": "essential"
        }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(memory["inclusion"], "essential");
    let memory_id = memory["id"].as_str().unwrap().to_string();

    // The same fact with different spacing and case must not duplicate.
    client
        .post(format!("{base}/api/principals/{bot_id}/memories"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({ "text": "  prefere   RESPOSTAS curtas. " }))
        .send()
        .await
        .unwrap();
    let listed: Value = client
        .get(format!("{base}/api/principals/{bot_id}/memories"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(listed["memories"].as_array().map(Vec::len), Some(1));

    let patched: Value = client
        .patch(format!("{base}/api/memories/{memory_id}"))
        .header("X-Jeff-CSRF", &csrf)
        .json(&serde_json::json!({ "inclusion": "searchable" }))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(patched["inclusion"], "searchable");
    assert_eq!(patched["revision"], 2);

    client
        .delete(format!("{base}/api/memories/{memory_id}"))
        .header("X-Jeff-CSRF", &csrf)
        .send()
        .await
        .unwrap();
    let empty: Value = client
        .get(format!("{base}/api/principals/{bot_id}/memories"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(empty["memories"].as_array().map(Vec::len), Some(0));
}
