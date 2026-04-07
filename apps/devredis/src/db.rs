use bytes::Bytes;
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Notify};

/// A handle to the shared database. Cheaply cloneable.
#[derive(Clone)]
pub struct Db {
    shared: Arc<Shared>,
}

pub struct Shared {
    state: Mutex<State>,
    /// Notifies the background expiry task when a new expiry is set.
    background_task: Notify,
    /// Pub/sub channels.
    pub(crate) pub_sub: Mutex<PubSub>,
}

pub struct State {
    /// Key-value storage.
    pub(crate) entries: HashMap<String, Entry>,
    /// Tracks key expirations, sorted by instant.
    pub(crate) expirations: BTreeSet<(Instant, String)>,
    /// Whether the Db has been shut down.
    shutdown: bool,
}

pub struct PubSub {
    channels: HashMap<String, broadcast::Sender<Bytes>>,
}

/// A stored value with optional expiry.
pub(crate) struct Entry {
    pub(crate) data: Value,
    pub(crate) expires_at: Option<Instant>,
}

/// The possible data types stored in the database.
#[derive(Clone)]
pub enum Value {
    String(Bytes),
    List(VecDeque<Bytes>),
}

impl Default for Db {
    fn default() -> Self {
        Self::new()
    }
}

impl Db {
    /// Create a new Db and spawn the background expiry task.
    pub fn new() -> Db {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                entries: HashMap::new(),
                expirations: BTreeSet::new(),
                shutdown: false,
            }),
            background_task: Notify::new(),
            pub_sub: Mutex::new(PubSub {
                channels: HashMap::new(),
            }),
        });

        // Spawn background task to purge expired keys.
        tokio::spawn(purge_expired_task(shared.clone()));

        Db { shared }
    }

    /// Lock the state and return a guard. Must not be held across await points.
    pub fn lock_state(&self) -> MutexGuard<'_, State> {
        self.shared.state.lock().unwrap()
    }

    /// GET: Return the value of a string key.
    pub fn get(&self, key: &str) -> Option<Bytes> {
        let state = self.shared.state.lock().unwrap();
        state.get_string(key)
    }

    /// SET: Store a string value, optionally with an expiry.
    pub fn set(&self, key: String, value: Bytes, expire: Option<Duration>) {
        let mut state = self.shared.state.lock().unwrap();
        state.set(key, Value::String(value), expire);
        // If we set a new expiry, notify the background task.
        drop(state);
        self.shared.background_task.notify_one();
    }

    /// DEL: Remove one or more keys. Returns the number of keys removed.
    pub fn del(&self, keys: &[String]) -> i64 {
        let mut state = self.shared.state.lock().unwrap();
        let mut count = 0;
        for key in keys {
            if state.remove(key) {
                count += 1;
            }
        }
        count
    }

    /// EXPIRE: Set a timeout on a key. Returns true if the key exists.
    pub fn expire(&self, key: &str, seconds: i64) -> bool {
        let mut state = self.shared.state.lock().unwrap();
        let result = state.set_expire(key, seconds);
        drop(state);
        if result {
            self.shared.background_task.notify_one();
        }
        result
    }

    /// KEYS: Return all keys matching a glob pattern.
    pub fn keys(&self, pattern: &str) -> Vec<String> {
        let state = self.shared.state.lock().unwrap();
        state
            .entries
            .keys()
            .filter(|k| glob_match(pattern, k))
            .cloned()
            .collect()
    }

    // --- List operations ---

    /// RPUSH: Append values to the tail of a list. Creates the list if missing.
    /// Returns the new length of the list.
    pub fn rpush(&self, key: String, values: Vec<Bytes>) -> Result<i64, String> {
        let mut state = self.shared.state.lock().unwrap();
        let list = state.get_or_create_list(&key)?;
        for v in values {
            list.push_back(v);
        }
        Ok(list.len() as i64)
    }

    /// LPOP: Remove and return the first element of a list.
    pub fn lpop(&self, key: &str) -> Result<Option<Bytes>, String> {
        let mut state = self.shared.state.lock().unwrap();
        match state.entries.get_mut(key) {
            Some(entry) => match &mut entry.data {
                Value::List(list) => {
                    let val = list.pop_front();
                    if list.is_empty() {
                        state.remove(key);
                    }
                    Ok(val)
                }
                Value::String(_) => {
                    Err("WRONGTYPE Operation against a key holding the wrong kind of value".into())
                }
            },
            None => Ok(None),
        }
    }

    /// RPOPLPUSH: Atomically pop from tail of source, push to head of destination.
    pub fn rpoplpush(&self, source: &str, destination: &str) -> Result<Option<Bytes>, String> {
        let mut state = self.shared.state.lock().unwrap();

        // Pop from source.
        let val = match state.entries.get_mut(source) {
            Some(entry) => match &mut entry.data {
                Value::List(list) => list.pop_back(),
                Value::String(_) => {
                    return Err(
                        "WRONGTYPE Operation against a key holding the wrong kind of value".into(),
                    );
                }
            },
            None => return Ok(None),
        };

        let val = match val {
            Some(v) => v,
            None => return Ok(None),
        };

        // Clean up source if empty.
        if let Some(entry) = state.entries.get(source) {
            if let Value::List(list) = &entry.data {
                if list.is_empty() {
                    state.remove(source);
                }
            }
        }

        // Push to destination.
        let dest_list = state.get_or_create_list(destination)?;
        dest_list.push_front(val.clone());

        Ok(Some(val))
    }

    /// LREM: Remove elements from a list.
    /// count > 0: remove `count` elements equal to `value` from head.
    /// count < 0: remove `|count|` elements equal to `value` from tail.
    /// count == 0: remove all elements equal to `value`.
    pub fn lrem(&self, key: &str, count: i64, value: &Bytes) -> Result<i64, String> {
        let mut state = self.shared.state.lock().unwrap();
        match state.entries.get_mut(key) {
            Some(entry) => match &mut entry.data {
                Value::List(list) => {
                    let removed = lrem_impl(list, count, value);
                    if list.is_empty() {
                        state.remove(key);
                    }
                    Ok(removed)
                }
                Value::String(_) => {
                    Err("WRONGTYPE Operation against a key holding the wrong kind of value".into())
                }
            },
            None => Ok(0),
        }
    }

    // --- Pub/Sub ---

    /// PUBLISH: Send a message to a channel. Returns the number of subscribers
    /// that received the message.
    pub fn publish(&self, channel: &str, message: Bytes) -> i64 {
        let pub_sub = self.shared.pub_sub.lock().unwrap();
        match pub_sub.channels.get(channel) {
            Some(sender) => {
                // send returns Err if there are no receivers, which is fine.
                sender.send(message).unwrap_or(0) as i64
            }
            None => 0,
        }
    }

    /// Subscribe to a channel. Returns a receiver for messages.
    pub fn subscribe(&self, channel: String) -> broadcast::Receiver<Bytes> {
        let mut pub_sub = self.shared.pub_sub.lock().unwrap();
        let sender = pub_sub
            .channels
            .entry(channel)
            .or_insert_with(|| broadcast::channel(1024).0);
        sender.subscribe()
    }

    /// Signal shutdown.
    pub fn shutdown(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.shutdown = true;
        drop(state);
        self.shared.background_task.notify_one();
    }
}

impl State {
    /// Get a string value, returning None if the key doesn't exist or is expired.
    pub fn get_string(&self, key: &str) -> Option<Bytes> {
        match self.entries.get(key) {
            Some(entry) => {
                if entry.is_expired() {
                    return None;
                }
                match &entry.data {
                    Value::String(val) => Some(val.clone()),
                    Value::List(_) => None,
                }
            }
            None => None,
        }
    }

    /// Set a key to a value with an optional expiry.
    pub fn set(&mut self, key: String, value: Value, expire: Option<Duration>) {
        // Remove the old expiry if present.
        if let Some(old_entry) = self.entries.get(&key) {
            if let Some(when) = old_entry.expires_at {
                self.expirations.remove(&(when, key.clone()));
            }
        }

        let expires_at = expire.map(|dur| {
            let when = Instant::now() + dur;
            self.expirations.insert((when, key.clone()));
            when
        });

        self.entries.insert(
            key,
            Entry {
                data: value,
                expires_at,
            },
        );
    }

    /// Set expiry on an existing key. Returns true if the key exists.
    pub fn set_expire(&mut self, key: &str, seconds: i64) -> bool {
        // First read the old expiry, then mutate.
        let old_expiry = self.entries.get(key).and_then(|e| e.expires_at);
        if let Some(entry) = self.entries.get_mut(key) {
            let when = Instant::now() + Duration::from_secs(seconds as u64);
            if let Some(old) = old_expiry {
                self.expirations.remove(&(old, key.to_string()));
            }
            entry.expires_at = Some(when);
            self.expirations.insert((when, key.to_string()));
            true
        } else {
            false
        }
    }

    /// Remove a key. Returns true if it existed.
    pub fn remove(&mut self, key: &str) -> bool {
        if let Some(entry) = self.entries.remove(key) {
            if let Some(when) = entry.expires_at {
                self.expirations.remove(&(when, key.to_string()));
            }
            true
        } else {
            false
        }
    }

    /// Get a mutable reference to a list, creating it if the key doesn't exist.
    /// Returns an error if the key exists but holds a different type.
    pub fn get_or_create_list(&mut self, key: &str) -> Result<&mut VecDeque<Bytes>, String> {
        if !self.entries.contains_key(key) {
            self.entries.insert(
                key.to_string(),
                Entry {
                    data: Value::List(VecDeque::new()),
                    expires_at: None,
                },
            );
        }
        match &mut self.entries.get_mut(key).unwrap().data {
            Value::List(list) => Ok(list),
            Value::String(_) => {
                Err("WRONGTYPE Operation against a key holding the wrong kind of value".into())
            }
        }
    }
}

impl Entry {
    fn is_expired(&self) -> bool {
        self.expires_at
            .map(|when| Instant::now() >= when)
            .unwrap_or(false)
    }
}

/// Background task that purges expired keys.
async fn purge_expired_task(shared: Arc<Shared>) {
    loop {
        // Find the next expiry time.
        let next = {
            let state = shared.state.lock().unwrap();
            if state.shutdown {
                return;
            }
            state.expirations.iter().next().map(|(when, _)| *when)
        };

        match next {
            Some(when) => {
                // Wait until the next expiry time or a notification.
                tokio::select! {
                    _ = tokio::time::sleep_until(when.into()) => {}
                    _ = shared.background_task.notified() => {}
                }
            }
            None => {
                // No expirations, wait for notification.
                shared.background_task.notified().await;
            }
        }

        // Purge all expired keys.
        let now = Instant::now();
        let mut state = shared.state.lock().unwrap();
        if state.shutdown {
            return;
        }

        while let Some((when, key)) = state.expirations.iter().next().cloned() {
            if when > now {
                break;
            }
            state.entries.remove(&key);
            state.expirations.remove(&(when, key));
        }
    }
}

/// Remove elements from a VecDeque.
fn lrem_impl(list: &mut VecDeque<Bytes>, count: i64, value: &Bytes) -> i64 {
    if count == 0 {
        // Remove all occurrences.
        let before = list.len();
        list.retain(|v| v != value);
        (before - list.len()) as i64
    } else if count > 0 {
        // Remove from head.
        let mut removed = 0;
        let mut i = 0;
        while i < list.len() && removed < count {
            if list[i] == *value {
                list.remove(i);
                removed += 1;
            } else {
                i += 1;
            }
        }
        removed
    } else {
        // Remove from tail.
        let max = count.unsigned_abs();
        let mut removed = 0u64;
        let mut i = list.len();
        while i > 0 && removed < max {
            i -= 1;
            if list[i] == *value {
                list.remove(i);
                removed += 1;
            }
        }
        removed as i64
    }
}

/// Simple glob pattern matching (supports *, ?, [abc], backslash escaping).
pub fn glob_match(pattern: &str, input: &str) -> bool {
    let pat: Vec<char> = pattern.chars().collect();
    let inp: Vec<char> = input.chars().collect();
    glob_match_inner(&pat, &inp)
}

fn glob_match_inner(pat: &[char], inp: &[char]) -> bool {
    let (mut pi, mut ii) = (0, 0);
    let (mut star_pi, mut star_ii) = (usize::MAX, usize::MAX);

    while ii < inp.len() {
        if pi < pat.len() && pat[pi] == '\\' {
            // Escaped character - match literally.
            pi += 1;
            if pi < pat.len() && inp[ii] == pat[pi] {
                pi += 1;
                ii += 1;
                continue;
            }
            // Backslash at end or mismatch.
            if star_pi != usize::MAX {
                pi = star_pi + 1;
                star_ii += 1;
                ii = star_ii;
                continue;
            }
            return false;
        }

        if pi < pat.len() && pat[pi] == '?' {
            pi += 1;
            ii += 1;
        } else if pi < pat.len() && pat[pi] == '*' {
            star_pi = pi;
            star_ii = ii;
            pi += 1;
        } else if pi < pat.len() && pat[pi] == '[' {
            // Character class.
            pi += 1;
            let mut matched = false;
            while pi < pat.len() && pat[pi] != ']' {
                if pi + 2 < pat.len() && pat[pi + 1] == '-' {
                    if inp[ii] >= pat[pi] && inp[ii] <= pat[pi + 2] {
                        matched = true;
                    }
                    pi += 3;
                } else {
                    if inp[ii] == pat[pi] {
                        matched = true;
                    }
                    pi += 1;
                }
            }
            if pi < pat.len() {
                pi += 1; // skip ']'
            }
            if matched {
                ii += 1;
            } else if star_pi != usize::MAX {
                pi = star_pi + 1;
                star_ii += 1;
                ii = star_ii;
            } else {
                return false;
            }
        } else if pi < pat.len() && pat[pi] == inp[ii] {
            pi += 1;
            ii += 1;
        } else if star_pi != usize::MAX {
            pi = star_pi + 1;
            star_ii += 1;
            ii = star_ii;
        } else {
            return false;
        }
    }

    // Consume trailing *'s.
    while pi < pat.len() && pat[pi] == '*' {
        pi += 1;
    }

    pi == pat.len()
}
