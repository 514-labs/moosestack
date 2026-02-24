//! Terminal setup and management for Dev TUI
//!
//! This module handles terminal initialization, cleanup, and rendering.
//! It includes panic hooks to ensure the terminal is always restored to
//! a usable state even if the application crashes.

// TODO(PR5): Remove this allow once mod.rs entry point uses Tui
#![allow(dead_code)]

use super::app::DevTuiApp;
use super::event::EventHandler;
use super::ui;
use super::DevTuiResult;
use crossterm::event::{DisableMouseCapture, EnableMouseCapture};
use crossterm::terminal::{self, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::Backend;
use ratatui::Terminal;
use std::io;
use std::panic;

/// Representation of the terminal user interface.
///
/// Responsible for setting up the terminal, initializing the interface,
/// and handling draw events.
#[derive(Debug)]
pub struct Tui<B: Backend> {
    /// Interface to the Terminal
    terminal: Terminal<B>,
    /// Terminal event handler
    pub events: EventHandler,
}

impl<B: Backend> Tui<B> {
    /// Constructs a new instance of [`Tui`]
    pub fn new(terminal: Terminal<B>, events: EventHandler) -> Self {
        Self { terminal, events }
    }

    /// Initializes the terminal interface.
    ///
    /// Enables raw mode and sets terminal properties.
    pub fn init(&mut self) -> DevTuiResult<()> {
        terminal::enable_raw_mode()?;
        crossterm::execute!(io::stderr(), EnterAlternateScreen, EnableMouseCapture)?;

        // Define a custom panic hook to reset the terminal properties.
        // This ensures the terminal isn't left in a broken state if a panic occurs.
        let panic_hook = panic::take_hook();
        panic::set_hook(Box::new(move |panic| {
            Self::reset().expect("Failed to reset the terminal");
            panic_hook(panic);
        }));

        self.terminal.hide_cursor()?;
        self.terminal.clear()?;
        Ok(())
    }

    /// Draw the terminal interface by rendering the widgets.
    pub fn draw(&mut self, app: &mut DevTuiApp) -> DevTuiResult<()> {
        self.terminal.draw(|frame| {
            app.viewport = frame.size();
            ui::render(app, frame);
        })?;
        Ok(())
    }

    /// Resets the terminal interface.
    ///
    /// This function is also used by the panic hook to restore the terminal.
    fn reset() -> DevTuiResult<()> {
        terminal::disable_raw_mode()?;
        crossterm::execute!(io::stderr(), LeaveAlternateScreen, DisableMouseCapture)?;
        Ok(())
    }

    /// Exits the terminal interface.
    ///
    /// Disables raw mode and reverts terminal properties.
    pub fn exit(&mut self) -> DevTuiResult<()> {
        Self::reset()?;
        self.terminal.show_cursor()?;
        Ok(())
    }
}
