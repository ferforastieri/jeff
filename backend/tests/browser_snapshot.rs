use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

use serde_json::json;

const PAGE: &str = r#"<!doctype html>
<html><head><title>Loja</title></head>
<body>
  <h1>Loja de teste</h1>
  <button id="buy">Comprar</button>
  <input id="name" placeholder="Nome" />
  <textarea id="note" placeholder="Observação"></textarea>
  <select id="size" aria-label="Tamanho"><option value="p">P</option><option value="m">M</option></select>
  <input type="checkbox" id="ok" aria-label="Aceito" />
  <script>
    document.getElementById('buy').onclick = () => {
      document.getElementById('note').value = 'comprado';
    };
  </script>
</body></html>"#;

fn serve() -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let mut buffer = [0u8; 2048];
            let _ = stream.read(&mut buffer);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                PAGE.len(),
                PAGE
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });
    address
}

#[tokio::test]
async fn snapshot_exposes_refs_and_actions_reach_the_page() {
    let address = serve();
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().to_path_buf();
    let browser = jeff_server::browser::BrowserManager::new(root.clone());
    let session = browser.session("bot-test", &root).await.unwrap();

    session.open(&format!("http://{address}/")).await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;

    let snapshot = session.snapshot().await.unwrap();
    let elements = snapshot["elements"].as_array().cloned().unwrap_or_default();
    let button = elements
        .iter()
        .find(|element| element["name"] == "Comprar")
        .expect("the button must be in the snapshot");
    let input = elements
        .iter()
        .find(|element| element["name"] == "Nome")
        .expect("the input must be in the snapshot");
    let button_ref = button["ref"].as_str().unwrap().to_string();
    let input_ref = input["ref"].as_str().unwrap().to_string();

    let select = elements
        .iter()
        .find(|element| element["name"] == "Tamanho")
        .expect("the select must be in the snapshot");
    let checkbox = elements
        .iter()
        .find(|element| element["name"] == "Aceito")
        .expect("the checkbox must be in the snapshot");

    session.click_ref(&button_ref).await.unwrap();
    session.type_ref(&input_ref, "Jeff").await.unwrap();
    session
        .select_option(select["ref"].as_str().unwrap(), "m")
        .await
        .unwrap();
    session
        .set_checked(checkbox["ref"].as_str().unwrap(), true)
        .await
        .unwrap();
    let state = session
        .evaluate("JSON.stringify({size: document.getElementById('size').value, ok: document.getElementById('ok').checked})")
        .await
        .unwrap();
    let state: serde_json::Value = serde_json::from_str(state.as_str().unwrap_or("{}")).unwrap();
    assert_eq!(state["size"], "m");
    assert_eq!(state["ok"], true);

    let note = session
        .command(
            "Runtime.evaluate",
            json!({ "expression": "document.getElementById('note').value", "returnByValue": true }),
        )
        .await
        .unwrap();
    assert_eq!(note["result"]["result"]["value"], "comprado");

    let name = session
        .command(
            "Runtime.evaluate",
            json!({ "expression": "document.getElementById('name').value", "returnByValue": true }),
        )
        .await
        .unwrap();
    assert_eq!(name["result"]["result"]["value"], "Jeff");

    session.close().await;
}
