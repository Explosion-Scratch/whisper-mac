use anyhow::Result;
use clap::Parser;
use serde::Serialize;
use std::path::PathBuf;
use transcribe_rs::{engines::parakeet::ParakeetEngine, TranscriptionEngine};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Path to the audio file
    #[arg(short, long)]
    file: PathBuf,

    /// Path to the model directory or file
    #[arg(short, long)]
    model: PathBuf,

    /// Output format (json or text)
    #[arg(short, long, default_value = "json")]
    output: String,
}

#[derive(Serialize)]
struct TranscriptionOutput {
    text: String,
    segments: Vec<Segment>,
    processing_time_ms: u128,
}

#[derive(Serialize)]
struct Segment {
    start: f64,
    end: f64,
    text: String,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let start_time = std::time::Instant::now();

    let mut engine = ParakeetEngine::new();

    // Load model
    // Note: Parakeet engine in transcribe-rs might expect a directory or specific file structure
    // Based on usage: engine.load_model(&PathBuf::from("path/to/model"))
    engine
        .load_model(&args.model)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    // Transcribe
    let result = engine
        .transcribe_file(&args.file, None)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let duration = start_time.elapsed();

    if args.output == "json" {
        // Convert result segments to our serializable format
        // Assuming result.segments exists and has start/end/text
        // If transcribe-rs doesn't expose segments directly in the same way, we might need to adjust
        // For now, let's assume a simple mapping or just text if segments aren't available

        // Check transcribe-rs source or docs for TranscriptionResult structure if possible
        // For now, I'll assume a basic structure and refine if compilation fails

        let segments: Vec<Segment> = result
            .segments
            .unwrap_or_default()
            .into_iter()
            .map(|s| Segment {
                start: s.start as f64,
                end: s.end as f64,
                text: s.text,
            })
            .collect();

        let output = TranscriptionOutput {
            text: result.text,
            segments,
            processing_time_ms: duration.as_millis(),
        };

        println!("{}", serde_json::to_string(&output)?);
    } else {
        println!("{}", result.text);
    }

    Ok(())
}
