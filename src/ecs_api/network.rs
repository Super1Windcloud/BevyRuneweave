use std::{
    collections::{BTreeMap, HashMap},
    io::Read,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicU32, Ordering},
    },
    time::Duration,
};

use bevy::prelude::Resource;

use super::EcsValue;

const MAX_RESPONSE_BYTES: u64 = 1024 * 1024;

enum HttpRequestState {
    Pending,
    Complete { status: u16, body: String },
    Error(String),
}

#[derive(Resource, Clone)]
pub(super) struct NetworkBridge {
    client: Option<reqwest::blocking::Client>,
    requests: Arc<Mutex<HashMap<u32, HttpRequestState>>>,
    next_id: Arc<AtomicU32>,
}

impl Default for NetworkBridge {
    fn default() -> Self {
        Self {
            client: reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(30))
                .build()
                .ok(),
            requests: Arc::default(),
            next_id: Arc::new(AtomicU32::new(1)),
        }
    }
}

impl NetworkBridge {
    fn lock(&self) -> MutexGuard<'_, HashMap<u32, HttpRequestState>> {
        self.requests
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    pub fn get(&self, url: String) -> u32 {
        self.start(move |client| client.get(url))
    }

    pub fn post(&self, url: String, body: String, content_type: String) -> u32 {
        self.start(move |client| {
            client
                .post(url)
                .header(reqwest::header::CONTENT_TYPE, content_type)
                .body(body)
        })
    }

    fn start(
        &self,
        build: impl FnOnce(&reqwest::blocking::Client) -> reqwest::blocking::RequestBuilder
        + Send
        + 'static,
    ) -> u32 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.lock().insert(id, HttpRequestState::Pending);
        let requests = Arc::clone(&self.requests);
        let Some(client) = self.client.clone() else {
            self.lock().insert(
                id,
                HttpRequestState::Error("HTTP client initialization failed".to_owned()),
            );
            return id;
        };
        std::thread::spawn(move || {
            let result = perform_request(build(&client));
            requests
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
                .insert(id, result);
        });
        id
    }

    pub fn poll(&self, id: u32) -> EcsValue {
        let state = {
            let mut requests = self.lock();
            match requests.get(&id) {
                Some(HttpRequestState::Pending) => return state_value("pending", []),
                Some(_) => requests.remove(&id),
                None => None,
            }
        };
        match state {
            Some(HttpRequestState::Complete { status, body }) => state_value(
                "complete",
                [
                    ("status", EcsValue::Number(f64::from(status))),
                    ("body", EcsValue::String(body)),
                ],
            ),
            Some(HttpRequestState::Error(error)) => {
                state_value("error", [("error", EcsValue::String(error))])
            }
            Some(HttpRequestState::Pending) => unreachable!(),
            None => state_value("unknown", []),
        }
    }
}

fn perform_request(request: reqwest::blocking::RequestBuilder) -> HttpRequestState {
    let response = match request.send() {
        Ok(response) => response,
        Err(error) => return HttpRequestState::Error(error.to_string()),
    };
    let status = response.status().as_u16();
    let mut body = String::new();
    match response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_string(&mut body)
    {
        Ok(bytes) if bytes as u64 <= MAX_RESPONSE_BYTES => {
            HttpRequestState::Complete { status, body }
        }
        Ok(_) => HttpRequestState::Error("HTTP response exceeds 1 MiB".to_owned()),
        Err(error) => HttpRequestState::Error(error.to_string()),
    }
}

fn state_value<const N: usize>(state: &str, fields: [(&str, EcsValue); N]) -> EcsValue {
    let mut result = BTreeMap::from([("state".to_owned(), EcsValue::String(state.to_owned()))]);
    result.extend(
        fields
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value)),
    );
    EcsValue::Object(result)
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };

    use super::*;

    #[test]
    fn http_requests_complete_without_blocking_the_caller() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                .unwrap();
        });

        let network = NetworkBridge::default();
        let request = network.get(format!("http://{address}"));
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let result = network.poll(request);
            let EcsValue::Object(fields) = result else {
                panic!("HTTP poll must return an object");
            };
            match fields.get("state") {
                Some(EcsValue::String(state)) if state == "pending" => {
                    assert!(Instant::now() < deadline, "HTTP request timed out");
                    thread::sleep(Duration::from_millis(10));
                }
                Some(EcsValue::String(state)) if state == "complete" => {
                    assert_eq!(fields.get("status"), Some(&EcsValue::Number(200.0)));
                    assert_eq!(fields.get("body"), Some(&EcsValue::String("ok".to_owned())));
                    break;
                }
                other => panic!("unexpected HTTP state: {other:?}"),
            }
        }
    }
}
