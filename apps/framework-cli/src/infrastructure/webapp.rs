use tokio::sync::mpsc::Sender;

use crate::framework::core::infrastructure_map::WebAppChange;

#[derive(Debug, thiserror::Error)]
pub enum WebAppChangeError {
    #[error("Could not send the WebApp change to be executed")]
    Send(#[from] tokio::sync::mpsc::error::SendError<WebAppChange>),
}

pub async fn execute_changes(
    web_app_changes: &[WebAppChange],
    webapp_changes_channel: Sender<WebAppChange>,
) -> Result<(), WebAppChangeError> {
    log::info!("📤 Sending {} WebApp changes", web_app_changes.len());
    for webapp_change in web_app_changes.iter() {
        log::info!("📤 Sending WebApp change: {:?}", webapp_change);
        webapp_changes_channel.send(webapp_change.clone()).await?;
    }

    Ok(())
}
