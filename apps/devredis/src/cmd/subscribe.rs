use crate::connection::Connection;
use crate::db::Db;
use crate::frame::Frame;
use crate::parse::Parse;
use crate::shutdown::Shutdown;
use bytes::Bytes;
use tokio::sync::broadcast;

/// SUBSCRIBE channel [channel ...]
pub struct Subscribe {
    channels: Vec<String>,
}

impl Subscribe {
    pub fn parse(parse: &mut Parse) -> crate::Result<Subscribe> {
        let mut channels = vec![parse.next_string()?];
        while parse.remaining() > 0 {
            channels.push(parse.next_string()?);
        }
        Ok(Subscribe { channels })
    }

    pub async fn apply(
        self,
        db: &Db,
        dst: &mut Connection,
        shutdown: &mut Shutdown,
    ) -> crate::Result<()> {
        let mut subscriptions: Vec<(String, broadcast::Receiver<Bytes>)> = Vec::new();

        // Subscribe to initial channels and send confirmations.
        for channel in &self.channels {
            let rx = db.subscribe(channel.clone());
            subscriptions.push((channel.clone(), rx));

            // Send subscription confirmation.
            let response = Frame::Array(vec![
                Frame::Bulk(Bytes::from_static(b"subscribe")),
                Frame::Bulk(Bytes::from(channel.clone())),
                Frame::Integer(subscriptions.len() as i64),
            ]);
            dst.write_frame(&response).await?;
        }

        // Enter pub/sub event loop.
        loop {
            // Build a future that resolves when any subscription has a message.
            // We use select! over all receivers + client input + shutdown.

            // For simplicity, we poll one receiver at a time using a stream adapter.
            // This approach works since we typically have few subscriptions.
            let msg = next_message(&mut subscriptions);

            tokio::select! {
                // A message was received from one of the subscribed channels.
                Some((channel, payload)) = msg => {
                    let response = Frame::Array(vec![
                        Frame::Bulk(Bytes::from_static(b"message")),
                        Frame::Bulk(Bytes::from(channel)),
                        Frame::Bulk(payload),
                    ]);
                    dst.write_frame(&response).await?;
                }
                // Client sent a command while in pub/sub mode.
                result = dst.read_frame() => {
                    let frame = match result? {
                        Some(frame) => frame,
                        None => return Ok(()), // client disconnected
                    };

                    // In pub/sub mode, only SUBSCRIBE, UNSUBSCRIBE, PING, QUIT are allowed.
                    let mut parse = Parse::new(frame)?;
                    let cmd = parse.next_string()?.to_uppercase();
                    match cmd.as_str() {
                        "SUBSCRIBE" => {
                            while parse.remaining() > 0 {
                                let channel = parse.next_string()?;
                                let rx = db.subscribe(channel.clone());
                                subscriptions.push((channel.clone(), rx));

                                let response = Frame::Array(vec![
                                    Frame::Bulk(Bytes::from_static(b"subscribe")),
                                    Frame::Bulk(Bytes::from(channel)),
                                    Frame::Integer(subscriptions.len() as i64),
                                ]);
                                dst.write_frame(&response).await?;
                            }
                        }
                        "UNSUBSCRIBE" => {
                            if parse.remaining() == 0 {
                                // Unsubscribe from all.
                                for (ch, _) in subscriptions.drain(..) {
                                    let response = Frame::Array(vec![
                                        Frame::Bulk(Bytes::from_static(b"unsubscribe")),
                                        Frame::Bulk(Bytes::from(ch)),
                                        Frame::Integer(0),
                                    ]);
                                    dst.write_frame(&response).await?;
                                }
                                return Ok(());
                            }
                            while parse.remaining() > 0 {
                                let channel = parse.next_string()?;
                                subscriptions.retain(|(ch, _)| ch != &channel);
                                let response = Frame::Array(vec![
                                    Frame::Bulk(Bytes::from_static(b"unsubscribe")),
                                    Frame::Bulk(Bytes::from(channel)),
                                    Frame::Integer(subscriptions.len() as i64),
                                ]);
                                dst.write_frame(&response).await?;
                            }
                            if subscriptions.is_empty() {
                                return Ok(());
                            }
                        }
                        "PING" => {
                            let response = Frame::Array(vec![
                                Frame::Bulk(Bytes::from_static(b"pong")),
                                Frame::Bulk(Bytes::from_static(b"")),
                            ]);
                            dst.write_frame(&response).await?;
                        }
                        "QUIT" => {
                            let response = Frame::Simple("OK".to_string());
                            dst.write_frame(&response).await?;
                            return Ok(());
                        }
                        _ => {
                            let response = Frame::Error(format!(
                                "ERR Can't execute '{}': only (P)SUBSCRIBE / (P)UNSUBSCRIBE / PING / QUIT are allowed in this context",
                                cmd
                            ));
                            dst.write_frame(&response).await?;
                        }
                    }
                }
                // Server is shutting down.
                _ = shutdown.recv() => {
                    return Ok(());
                }
            }
        }
    }
}

/// Poll all subscription receivers and return the next message.
async fn next_message(
    subscriptions: &mut [(String, broadcast::Receiver<Bytes>)],
) -> Option<(String, Bytes)> {
    if subscriptions.is_empty() {
        // Never resolve if there are no subscriptions.
        std::future::pending::<()>().await;
        return None;
    }

    // Use tokio::select! over all receivers. For a small number of subs,
    // polling sequentially is fine.
    loop {
        for (channel, rx) in subscriptions.iter_mut() {
            match rx.try_recv() {
                Ok(msg) => return Some((channel.clone(), msg)),
                Err(broadcast::error::TryRecvError::Lagged(_)) => {
                    // Skip lagged messages.
                    continue;
                }
                Err(broadcast::error::TryRecvError::Empty) => continue,
                Err(broadcast::error::TryRecvError::Closed) => continue,
            }
        }
        // Yield to avoid busy-spinning, then retry.
        tokio::task::yield_now().await;
    }
}
