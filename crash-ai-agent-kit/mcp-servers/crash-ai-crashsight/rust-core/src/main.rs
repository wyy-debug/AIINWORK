use anyhow::{Context, Result};
use crash_ai_core::{ReportInput, generate_report};
use std::io::{self, Read};

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}

async fn run() -> Result<()> {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .context("read stdin JSON")?;
    let args: ReportInput = serde_json::from_str(&input).context("parse stdin JSON")?;
    let report = generate_report(args).await?;
    println!("{}", serde_json::to_string(&report)?);
    Ok(())
}
