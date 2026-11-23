use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::crypto::{decrypt, encrypt, load_or_create_key};
use crate::errors::{bad_request, AppError, AppResult};
use crate::store::Store;

const BASE: &str = "https://rtc.live.cloudflare.com/v1/apps";

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackInput {
    pub mid: String,
    pub track_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscribeInput {
    pub mid: String,
    pub session_id: String,
    pub track_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Participant {
    pub principal_id: String,
    pub name: String,
    pub session_id: String,
    pub tracks: Vec<String>,
}

#[derive(Clone, Debug)]
struct Entry {
    session_id: String,
    name: String,
    tracks: Vec<String>,
    mids: Vec<String>,
}

struct Inner {
    store: Store,
    key: Vec<u8>,
    http: reqwest::Client,
    rooms: Mutex<HashMap<String, HashMap<String, Entry>>>,
}

#[derive(Clone)]
pub struct VoiceService {
    inner: Arc<Inner>,
}

impl VoiceService {
    pub fn new(store: Store, key_path: &Path) -> AppResult<Self> {
        let key = load_or_create_key(key_path)?;
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .build()
            .map_err(|error| AppError::Internal(error.into()))?;
        Ok(Self {
            inner: Arc::new(Inner {
                store,
                key,
                http,
                rooms: Mutex::new(HashMap::new()),
            }),
        })
    }

    pub async fn config(&self) -> AppResult<Value> {
        let app_id = self
            .inner
            .store
            .setting("voice.app_id")
            .await
            .unwrap_or_default();
        let configured = !app_id.trim().is_empty()
            && self
                .inner
                .store
                .setting("voice.secret_enc")
                .await
                .map(|value| !value.is_empty())
                .unwrap_or(false);
        Ok(json!({ "appId": app_id, "configured": configured }))
    }

    pub async fn save(&self, app_id: &str, secret: &str) -> AppResult<Value> {
        let app_id = app_id.trim();
        if app_id.is_empty() {
            return Err(bad_request("Informe o App ID do Cloudflare Realtime."));
        }
        self.inner.store.set_setting("voice.app_id", app_id).await?;
        if !secret.trim().is_empty() {
            let encrypted = encrypt(&self.inner.key, secret.trim())
                .map_err(|e| AppError::Internal(e.into()))?;
            self.inner
                .store
                .set_setting("voice.secret_enc", &encrypted)
                .await?;
        }
        self.config().await
    }

    async fn credentials(&self) -> AppResult<(String, String)> {
        let app_id = self
            .inner
            .store
            .setting("voice.app_id")
            .await
            .unwrap_or_default();
        let encrypted = self
            .inner
            .store
            .setting("voice.secret_enc")
            .await
            .unwrap_or_default();
        if app_id.trim().is_empty() || encrypted.is_empty() {
            return Err(AppError::ServiceUnavailable(
                "Voz não configurada. Informe o App ID e o secret do Cloudflare Realtime.".into(),
            ));
        }
        let secret = decrypt(&self.inner.key, &encrypted)
            .map_err(|_| AppError::ServiceUnavailable("Credencial de voz ilegível.".into()))?;
        Ok((app_id, secret))
    }

    async fn request(&self, method: reqwest::Method, path: &str, body: Value) -> AppResult<Value> {
        let (app_id, secret) = self.credentials().await?;
        let url = format!("{BASE}/{app_id}/{path}");
        let response = self
            .inner
            .http
            .request(method, &url)
            .bearer_auth(&secret)
            .json(&body)
            .send()
            .await
            .map_err(|error| AppError::Upstream(format!("Cloudflare Realtime: {error}")))?;
        let status = response.status();
        let value: Value = response.json().await.unwrap_or_else(|_| json!({}));
        if !status.is_success() {
            return Err(AppError::Upstream(format!(
                "Cloudflare Realtime respondeu {status}: {value}"
            )));
        }
        Ok(value)
    }

    pub async fn join(
        &self,
        room_id: &str,
        principal_id: &str,
        name: &str,
        sdp: &str,
        tracks: Vec<TrackInput>,
    ) -> AppResult<Value> {
        if self.participant(room_id, principal_id).is_some() {
            self.leave(room_id, principal_id).await.ok();
        }
        let created = self
            .request(reqwest::Method::POST, "sessions/new", json!({}))
            .await?;
        let session_id = created["sessionId"]
            .as_str()
            .ok_or_else(|| AppError::Upstream("Cloudflare não devolveu a sessão.".into()))?
            .to_string();
        let local = tracks
            .iter()
            .map(|track| {
                json!({
                    "location": "local",
                    "mid": track.mid,
                    "trackName": track.track_name,
                })
            })
            .collect::<Vec<_>>();
        let answer = self
            .request(
                reqwest::Method::POST,
                &format!("sessions/{session_id}/tracks/new"),
                json!({
                    "sessionDescription": { "type": "offer", "sdp": sdp },
                    "tracks": local,
                }),
            )
            .await?;
        let mids = tracks.iter().map(|track| track.mid.clone()).collect();
        let names = tracks
            .iter()
            .map(|track| track.track_name.clone())
            .collect();
        self.inner
            .rooms
            .lock()
            .unwrap()
            .entry(room_id.to_string())
            .or_default()
            .insert(
                principal_id.to_string(),
                Entry {
                    session_id: session_id.clone(),
                    name: name.to_string(),
                    tracks: names,
                    mids,
                },
            );
        Ok(json!({
            "sessionId": session_id,
            "sdp": answer["sessionDescription"]["sdp"],
            "tracks": answer["tracks"],
        }))
    }

    pub async fn exchange(
        &self,
        room_id: &str,
        principal_id: &str,
        sdp: &str,
        publish: Vec<TrackInput>,
        subscribe: Vec<SubscribeInput>,
    ) -> AppResult<Value> {
        let session_id = self
            .participant(room_id, principal_id)
            .map(|entry| entry.session_id)
            .ok_or_else(|| bad_request("Entre na sala de voz antes de trocar tracks."))?;
        let mut tracks = Vec::new();
        for track in &publish {
            tracks.push(json!({
                "location": "local",
                "mid": track.mid,
                "trackName": track.track_name,
            }));
        }
        for track in &subscribe {
            tracks.push(json!({
                "location": "remote",
                "mid": track.mid,
                "sessionId": track.session_id,
                "trackName": track.track_name,
            }));
        }
        let answer = self
            .request(
                reqwest::Method::POST,
                &format!("sessions/{session_id}/tracks/new"),
                json!({
                    "sessionDescription": { "type": "offer", "sdp": sdp },
                    "tracks": tracks,
                }),
            )
            .await?;
        if !publish.is_empty() {
            if let Some(map) = self.inner.rooms.lock().unwrap().get_mut(room_id) {
                if let Some(entry) = map.get_mut(principal_id) {
                    for track in &publish {
                        if !entry.tracks.contains(&track.track_name) {
                            entry.tracks.push(track.track_name.clone());
                        }
                        if !entry.mids.contains(&track.mid) {
                            entry.mids.push(track.mid.clone());
                        }
                    }
                }
            }
        }
        Ok(json!({
            "sdp": answer["sessionDescription"]["sdp"],
            "tracks": answer["tracks"],
        }))
    }

    pub async fn leave(&self, room_id: &str, principal_id: &str) -> AppResult<()> {
        let entry = {
            let mut rooms = self.inner.rooms.lock().unwrap();
            let entry = rooms
                .get_mut(room_id)
                .and_then(|map| map.remove(principal_id));
            if let Some(map) = rooms.get(room_id) {
                if map.is_empty() {
                    rooms.remove(room_id);
                }
            }
            entry
        };
        if let Some(entry) = entry {
            if !entry.mids.is_empty() {
                let tracks = entry
                    .mids
                    .iter()
                    .map(|mid| json!({ "mid": mid }))
                    .collect::<Vec<_>>();
                let _ = self
                    .request(
                        reqwest::Method::PUT,
                        &format!("sessions/{}/tracks/close", entry.session_id),
                        json!({ "tracks": tracks }),
                    )
                    .await;
            }
        }
        Ok(())
    }

    pub fn participants(&self, room_id: &str) -> Vec<Participant> {
        self.inner
            .rooms
            .lock()
            .unwrap()
            .get(room_id)
            .map(|map| {
                map.iter()
                    .map(|(id, entry)| Participant {
                        principal_id: id.clone(),
                        name: entry.name.clone(),
                        session_id: entry.session_id.clone(),
                        tracks: entry.tracks.clone(),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn participant(&self, room_id: &str, principal_id: &str) -> Option<Entry> {
        self.inner
            .rooms
            .lock()
            .unwrap()
            .get(room_id)
            .and_then(|map| map.get(principal_id))
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn voice_reports_missing_credentials_before_calling_cloudflare() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("jeff.db")).await.unwrap();
        let service = VoiceService::new(store, &dir.path().join("master.key")).unwrap();
        let config = service.config().await.unwrap();
        assert_eq!(config["configured"], false);
        let error = service
            .join("room", "principal", "Ana", "v=0", Vec::new())
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Voz não configurada"));
        let saved = service.save("app-id", "app-secret").await.unwrap();
        assert_eq!(saved["configured"], true);
        assert_eq!(saved["appId"], "app-id");
    }

    #[test]
    fn tracks_are_described_for_cloudflare() {
        let track = TrackInput {
            mid: "0".into(),
            track_name: "audio".into(),
        };
        assert_eq!(
            json!({
                "location": "local",
                "mid": track.mid,
                "trackName": track.track_name,
            })["location"],
            "local"
        );
    }
}
