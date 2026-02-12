//! Event handling for Dev TUI
//!
//! This module handles terminal events including keyboard input
//! and periodic ticks for UI updates.

// TODO(PR5): Remove this allow once mod.rs entry point uses EventHandler
#![allow(dead_code)]

use super::DevTuiResult;
use crossterm::event::{Event as CrosstermEvent, KeyEvent};
use futures::{FutureExt, StreamExt};
use std::time::Duration;
use tokio::sync::mpsc;

/// Terminal events
#[derive(Clone, Copy, Debug)]
pub enum Event {
    /// Periodic tick for UI updates
    Tick,
    /// Key press event
    Key(KeyEvent),
    /// Mouse scroll event (positive = down, negative = up)
    MouseScroll(i32),
}

/// Terminal event handler
///
/// Runs in a background task and sends events through a channel.
#[allow(dead_code)]
#[derive(Debug)]
pub struct EventHandler {
    /// Event sender channel
    sender: mpsc::UnboundedSender<Event>,
    /// Event receiver channel
    receiver: mpsc::UnboundedReceiver<Event>,
    /// Event handler task
    handler: tokio::task::JoinHandle<()>,
}

impl EventHandler {
    /// Constructs a new instance of [`EventHandler`]
    ///
    /// # Arguments
    /// * `tick_rate` - Tick rate in milliseconds
    pub fn new(tick_rate: u64) -> Self {
        let tick_rate = Duration::from_millis(tick_rate);
        let (sender, receiver) = mpsc::unbounded_channel();
        let _sender = sender.clone();

        let handler = tokio::spawn(async move {
            let mut reader = crossterm::event::EventStream::new();
            let mut tick = tokio::time::interval(tick_rate);

            loop {
                let tick_delay = tick.tick();
                let crossterm_event = reader.next().fuse();

                tokio::select! {
                    _ = _sender.closed() => {
                        break;
                    }
                    _ = tick_delay => {
                        if _sender.send(Event::Tick).is_err() {
                            break;
                        }
                    }
                    Some(Ok(evt)) = crossterm_event => {
                        match evt {
                            CrosstermEvent::Key(key) => {
                                // Only handle key press events (not release or repeat)
                                if key.kind == crossterm::event::KeyEventKind::Press
                                    && _sender.send(Event::Key(key)).is_err()
                                {
                                    break;
                                }
                            }
                            CrosstermEvent::Mouse(mouse) => {
                                use crossterm::event::MouseEventKind;
                                match mouse.kind {
                                    MouseEventKind::ScrollUp => {
                                        if _sender.send(Event::MouseScroll(-3)).is_err() {
                                            break;
                                        }
                                    }
                                    MouseEventKind::ScrollDown => {
                                        if _sender.send(Event::MouseScroll(3)).is_err() {
                                            break;
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            CrosstermEvent::Resize(_, _) => {
                                // Terminal resize is handled automatically by ratatui
                            }
                            _ => {}
                        }
                    }
                }
            }
        });

        Self {
            sender,
            receiver,
            handler,
        }
    }

    /// Receive the next event from the handler.
    ///
    /// This function will block until an event is available.
    pub async fn next(&mut self) -> DevTuiResult<Event> {
        self.receiver.recv().await.ok_or_else(|| {
            Box::new(std::io::Error::other("Event channel closed")) as Box<dyn std::error::Error>
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossterm::event::{KeyCode, KeyModifiers};

    // ==========================================================================
    // Event Enum Tests
    // ==========================================================================

    #[test]
    fn event_tick_can_be_created() {
        let event = Event::Tick;
        assert!(matches!(event, Event::Tick));
    }

    #[test]
    fn event_key_can_be_created() {
        let key_event = KeyEvent::new(KeyCode::Char('a'), KeyModifiers::empty());
        let event = Event::Key(key_event);
        assert!(matches!(event, Event::Key(_)));
    }

    #[test]
    fn event_is_copy() {
        let event = Event::Tick;
        let copied = event;
        assert!(matches!(copied, Event::Tick));
        // Original is still valid (Copy trait)
        assert!(matches!(event, Event::Tick));
    }

    #[test]
    fn event_is_clone() {
        let key_event = KeyEvent::new(KeyCode::Enter, KeyModifiers::empty());
        let event = Event::Key(key_event);
        // Use Clone trait explicitly (Event also implements Copy)
        let cloned = Clone::clone(&event);
        assert!(matches!(cloned, Event::Key(_)));
    }

    #[test]
    fn event_is_debug() {
        let event = Event::Tick;
        let debug_str = format!("{:?}", event);
        assert!(debug_str.contains("Tick"));
    }

    // ==========================================================================
    // Event Key Variant Tests
    // ==========================================================================

    #[test]
    fn event_key_preserves_keycode() {
        let key_event = KeyEvent::new(KeyCode::Char('q'), KeyModifiers::empty());
        let event = Event::Key(key_event);

        if let Event::Key(ke) = event {
            assert_eq!(ke.code, KeyCode::Char('q'));
        } else {
            panic!("Expected Event::Key");
        }
    }

    #[test]
    fn event_key_preserves_modifiers() {
        let key_event = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        let event = Event::Key(key_event);

        if let Event::Key(ke) = event {
            assert!(ke.modifiers.contains(KeyModifiers::CONTROL));
        } else {
            panic!("Expected Event::Key");
        }
    }

    #[test]
    fn event_key_with_multiple_modifiers() {
        let key_event = KeyEvent::new(
            KeyCode::Char('s'),
            KeyModifiers::CONTROL | KeyModifiers::SHIFT,
        );
        let event = Event::Key(key_event);

        if let Event::Key(ke) = event {
            assert!(ke.modifiers.contains(KeyModifiers::CONTROL));
            assert!(ke.modifiers.contains(KeyModifiers::SHIFT));
        } else {
            panic!("Expected Event::Key");
        }
    }

    // ==========================================================================
    // Event Pattern Matching Tests
    // ==========================================================================

    #[test]
    fn can_match_tick_event() {
        let event = Event::Tick;
        match event {
            Event::Tick => {} // Successfully matched
            _ => panic!("Should not match other variants"),
        }
    }

    #[test]
    fn event_mouse_scroll_can_be_created() {
        let event = Event::MouseScroll(-3);
        assert!(matches!(event, Event::MouseScroll(-3)));
    }

    #[test]
    fn can_match_key_event() {
        let key_event = KeyEvent::new(KeyCode::Esc, KeyModifiers::empty());
        let event = Event::Key(key_event);
        match event {
            Event::Key(ke) => assert_eq!(ke.code, KeyCode::Esc),
            _ => panic!("Should match Key"),
        }
    }

    // Note: Testing EventHandler::new() and EventHandler::next() requires
    // a real terminal environment or mocking crossterm, which is beyond
    // the scope of unit tests. These would be covered by integration tests.
}
