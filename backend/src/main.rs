use anyhow::Result;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    if let Err(error) = run().await {
        tracing::error!(%error, "jeff stopped");
        eprintln!("jeff: {error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    if matches!(
        std::env::args().nth(1).as_deref(),
        Some("mcp-tools") | Some("mcp-email")
    ) {
        jeff_server::features::integrations::email::mcp::serve().await?;
        return Ok(());
    }
    let config = jeff_server::config::Config::load()?;
    jeff_server::serve(config).await?;
    Ok(())
}
