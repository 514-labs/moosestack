use redis::AsyncCommands;
use std::net::TcpListener;
use std::time::Duration;
use tokio::time::sleep;
use tokio_stream::StreamExt;

/// Find a free port by binding to port 0.
fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.local_addr().unwrap().port()
}

/// Start a devredis server on a given port in the background.
fn start_server(port: u16) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port))
            .await
            .unwrap();
        let db = devredis::db::Db::new();
        let server = devredis::server::Listener::new(listener, db);
        // Run until the test drops the JoinHandle (which aborts the task).
        let _ = server.run().await;
    })
}

/// Create a redis async connection to a devredis instance.
async fn connect(port: u16) -> redis::aio::MultiplexedConnection {
    let client = redis::Client::open(format!("redis://127.0.0.1:{}", port)).unwrap();
    // Retry connection a few times while server starts.
    for _ in 0..50 {
        match client.get_multiplexed_async_connection().await {
            Ok(conn) => return conn,
            Err(_) => sleep(Duration::from_millis(20)).await,
        }
    }
    panic!("could not connect to devredis on port {}", port);
}

#[tokio::test]
async fn test_ping() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let result: String = redis::cmd("PING").query_async(&mut conn).await.unwrap();
    assert_eq!(result, "PONG");

    let result: String = redis::cmd("PING")
        .arg("hello")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, "hello");

    handle.abort();
}

#[tokio::test]
async fn test_get_set() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // GET nonexistent key.
    let result: Option<String> = conn.get("nonexistent").await.unwrap();
    assert_eq!(result, None);

    // SET and GET.
    let _: () = conn.set("mykey", "myvalue").await.unwrap();
    let result: String = conn.get("mykey").await.unwrap();
    assert_eq!(result, "myvalue");

    // Overwrite.
    let _: () = conn.set("mykey", "newvalue").await.unwrap();
    let result: String = conn.get("mykey").await.unwrap();
    assert_eq!(result, "newvalue");

    handle.abort();
}

#[tokio::test]
async fn test_set_ex() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // SET with EX.
    let _: () = redis::cmd("SET")
        .arg("exkey")
        .arg("exval")
        .arg("EX")
        .arg(1)
        .query_async(&mut conn)
        .await
        .unwrap();

    let result: String = conn.get("exkey").await.unwrap();
    assert_eq!(result, "exval");

    // Wait for expiry.
    sleep(Duration::from_millis(1100)).await;
    let result: Option<String> = conn.get("exkey").await.unwrap();
    assert_eq!(result, None);

    handle.abort();
}

#[tokio::test]
async fn test_setex() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // SETEX key seconds value.
    let _: () = redis::cmd("SETEX")
        .arg("sxkey")
        .arg(1)
        .arg("sxval")
        .query_async(&mut conn)
        .await
        .unwrap();

    let result: String = conn.get("sxkey").await.unwrap();
    assert_eq!(result, "sxval");

    // Wait for expiry.
    sleep(Duration::from_millis(1100)).await;
    let result: Option<String> = conn.get("sxkey").await.unwrap();
    assert_eq!(result, None);

    handle.abort();
}

#[tokio::test]
async fn test_del() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: () = conn.set("a", "1").await.unwrap();
    let _: () = conn.set("b", "2").await.unwrap();
    let _: () = conn.set("c", "3").await.unwrap();

    // DEL multiple keys.
    let count: i64 = conn.del(&["a", "b", "nonexistent"]).await.unwrap();
    assert_eq!(count, 2);

    // Verify deletion.
    let result: Option<String> = conn.get("a").await.unwrap();
    assert_eq!(result, None);
    let result: String = conn.get("c").await.unwrap();
    assert_eq!(result, "3");

    handle.abort();
}

#[tokio::test]
async fn test_expire() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: () = conn.set("expkey", "val").await.unwrap();

    // EXPIRE on existing key.
    let result: bool = conn.expire("expkey", 1).await.unwrap();
    assert!(result);

    // EXPIRE on nonexistent key.
    let result: bool = conn.expire("nonexistent", 1).await.unwrap();
    assert!(!result);

    // Key should still exist.
    let val: String = conn.get("expkey").await.unwrap();
    assert_eq!(val, "val");

    // Wait for expiry.
    sleep(Duration::from_millis(1100)).await;
    let result: Option<String> = conn.get("expkey").await.unwrap();
    assert_eq!(result, None);

    handle.abort();
}

#[tokio::test]
async fn test_keys() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: () = conn.set("user:1", "a").await.unwrap();
    let _: () = conn.set("user:2", "b").await.unwrap();
    let _: () = conn.set("session:1", "c").await.unwrap();

    let mut result: Vec<String> = conn.keys("user:*").await.unwrap();
    result.sort();
    assert_eq!(result, vec!["user:1", "user:2"]);

    let mut result: Vec<String> = conn.keys("*").await.unwrap();
    result.sort();
    assert_eq!(result, vec!["session:1", "user:1", "user:2"]);

    let result: Vec<String> = conn.keys("nonexistent:*").await.unwrap();
    assert!(result.is_empty());

    handle.abort();
}

#[tokio::test]
async fn test_list_rpush_lpop() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // RPUSH creates list.
    let len: i64 = conn.rpush("mylist", "a").await.unwrap();
    assert_eq!(len, 1);
    let len: i64 = conn.rpush("mylist", "b").await.unwrap();
    assert_eq!(len, 2);
    let len: i64 = conn.rpush("mylist", "c").await.unwrap();
    assert_eq!(len, 3);

    // LPOP from front.
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "a");
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "b");
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "c");

    // LPOP on empty/missing list.
    let val: Option<String> = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, None);

    handle.abort();
}

#[tokio::test]
async fn test_rpoplpush() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: i64 = conn.rpush("src", &["a", "b", "c"]).await.unwrap();

    // RPOPLPUSH: pop from tail of src, push to head of dst.
    let val: String = redis::cmd("RPOPLPUSH")
        .arg("src")
        .arg("dst")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(val, "c");

    let val: String = redis::cmd("RPOPLPUSH")
        .arg("src")
        .arg("dst")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(val, "b");

    // dst should now be [b, c].
    let val: String = conn.lpop("dst", None).await.unwrap();
    assert_eq!(val, "b");
    let val: String = conn.lpop("dst", None).await.unwrap();
    assert_eq!(val, "c");

    handle.abort();
}

#[tokio::test]
async fn test_lrem() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: i64 = conn
        .rpush("mylist", &["a", "b", "a", "c", "a"])
        .await
        .unwrap();

    // LREM count=2 from head: remove first 2 "a"s.
    let removed: i64 = conn.lrem("mylist", 2, "a").await.unwrap();
    assert_eq!(removed, 2);

    // List should be [b, c, a].
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "b");
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "c");
    let val: String = conn.lpop("mylist", None).await.unwrap();
    assert_eq!(val, "a");

    handle.abort();
}

#[tokio::test]
async fn test_pubsub() {
    let port = free_port();
    let handle = start_server(port);

    // Subscriber connection - use a dedicated non-multiplexed connection.
    let sub_client = redis::Client::open(format!("redis://127.0.0.1:{}", port)).unwrap();
    let mut conn = connect(port).await;

    // Give server time to start.
    sleep(Duration::from_millis(50)).await;

    let mut pubsub = sub_client.get_async_pubsub().await.unwrap();
    pubsub.subscribe("test-channel").await.unwrap();

    // Give subscription time to register.
    sleep(Duration::from_millis(50)).await;

    // Publish.
    let receivers: i64 = conn.publish("test-channel", "hello").await.unwrap();
    assert_eq!(receivers, 1);

    // Receive.
    let msg = pubsub.on_message().next().await.unwrap();
    let payload: String = msg.get_payload().unwrap();
    assert_eq!(payload, "hello");
    assert_eq!(msg.get_channel_name(), "test-channel");

    handle.abort();
}

#[tokio::test]
async fn test_eval_basic() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // Simple EVAL returning a value.
    let result: i64 = redis::cmd("EVAL")
        .arg("return 42")
        .arg(0)
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, 42);

    // EVAL with keys and args.
    let result: String = redis::cmd("EVAL")
        .arg("redis.call('SET', KEYS[1], ARGV[1]); return redis.call('GET', KEYS[1])")
        .arg(1)
        .arg("luakey")
        .arg("luaval")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, "luaval");

    // Verify the key was actually set.
    let val: String = conn.get("luakey").await.unwrap();
    assert_eq!(val, "luaval");

    handle.abort();
}

#[tokio::test]
async fn test_eval_lock_script() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // Simulate a typical distributed lock acquire script.
    let acquire_script = r#"
        local key = KEYS[1]
        local token = ARGV[1]
        local ttl = tonumber(ARGV[2])
        local current = redis.call('GET', key)
        if current == false then
            redis.call('SET', key, token, 'EX', ttl)
            return 1
        end
        return 0
    "#;

    // Acquire lock.
    let result: i64 = redis::cmd("EVAL")
        .arg(acquire_script)
        .arg(1)
        .arg("lock:resource")
        .arg("token123")
        .arg("10")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, 1);

    // Try to acquire again (should fail).
    let result: i64 = redis::cmd("EVAL")
        .arg(acquire_script)
        .arg(1)
        .arg("lock:resource")
        .arg("token456")
        .arg("10")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, 0);

    // Release lock script.
    let release_script = r#"
        local key = KEYS[1]
        local token = ARGV[1]
        local current = redis.call('GET', key)
        if current == token then
            redis.call('DEL', key)
            return 1
        end
        return 0
    "#;

    // Release with correct token.
    let result: i64 = redis::cmd("EVAL")
        .arg(release_script)
        .arg(1)
        .arg("lock:resource")
        .arg("token123")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, 1);

    // Now can acquire again.
    let result: i64 = redis::cmd("EVAL")
        .arg(acquire_script)
        .arg(1)
        .arg("lock:resource")
        .arg("token456")
        .arg("10")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(result, 1);

    handle.abort();
}

#[tokio::test]
async fn test_pipeline() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // Pipeline multiple commands.
    let (r1, r2, r3): (String, String, Option<String>) = redis::pipe()
        .cmd("SET")
        .arg("pk1")
        .arg("pv1")
        .cmd("SET")
        .arg("pk2")
        .arg("pv2")
        .cmd("GET")
        .arg("pk1")
        .query_async(&mut conn)
        .await
        .unwrap();

    assert_eq!(r1, "OK");
    assert_eq!(r2, "OK");
    assert_eq!(r3, Some("pv1".to_string()));

    handle.abort();
}

#[tokio::test]
async fn test_delete_python_alias() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    let _: () = conn.set("pykey", "pyval").await.unwrap();

    // Python redis client sends DELETE instead of DEL.
    let count: i64 = redis::cmd("DELETE")
        .arg("pykey")
        .query_async(&mut conn)
        .await
        .unwrap();
    assert_eq!(count, 1);

    let result: Option<String> = conn.get("pykey").await.unwrap();
    assert_eq!(result, None);

    handle.abort();
}

#[tokio::test]
async fn test_wrongtype_error() {
    let port = free_port();
    let handle = start_server(port);
    let mut conn = connect(port).await;

    // Create a string key.
    let _: () = conn.set("strkey", "value").await.unwrap();

    // Try RPUSH on string key - should error.
    let result: redis::RedisResult<i64> = conn.rpush("strkey", "item").await;
    assert!(result.is_err());
    let err = result.unwrap_err();
    assert!(err.to_string().contains("WRONGTYPE"));

    handle.abort();
}
