use anyhow::{Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use transcribe_rs::{engines::parakeet::ParakeetEngine, TranscriptionEngine};

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Run in server mode
    #[arg(short, long)]
    server: bool,

    /// Path to the audio file (CLI mode)
    #[arg(short, long)]
    file: Option<PathBuf>,

    /// Path to the model directory or file (CLI mode)
    #[arg(short, long)]
    model: Option<PathBuf>,

    /// Output format (json or text) (CLI mode)
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

#[derive(Deserialize, Debug)]
#[serde(tag = "command", rename_all = "snake_case")]
enum Command {
    LoadModel {
        path: String,
    },
    Transcribe {
        path: String,
        options: Option<TranscribeOptions>,
    },
    Ping,
}

#[derive(Deserialize, Debug)]
struct TranscribeOptions {
    // Add future options here if needed
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum Response {
    Ok {
        #[serde(skip_serializing_if = "Option::is_none")]
        data: Option<serde_json::Value>,
    },
    Error {
        message: String,
    },
}

fn main() -> Result<()> {
    env_logger::init();
    let args = Args::parse();

    if args.server {
        run_server()
    } else {
        run_cli(args)
    }
}

fn run_server() -> Result<()> {
    let mut engine = ParakeetEngine::new();
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    // Signal ready
    writeln!(stdout, "PARAKEET_SERVER_READY")?;
    stdout.flush()?;

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let response = match serde_json::from_str::<Command>(&line) {
            Ok(command) => process_command(&mut engine, command),
            Err(e) => Response::Error {
                message: format!("Invalid JSON: {}", e),
            },
        };

        writeln!(stdout, "{}", serde_json::to_string(&response)?)?;
        stdout.flush()?;
    }

    Ok(())
}

fn process_command(engine: &mut ParakeetEngine, command: Command) -> Response {
    match command {
        Command::Ping => Response::Ok { data: None },
        Command::LoadModel { path } => {
            match engine.load_model(&PathBuf::from(path)) {
                Ok(_) => Response::Ok { data: None },
                Err(e) => Response::Error {
                    message: format!("Failed to load model: {}", e),
                },
            }
        }
        Command::Transcribe { path, options: _ } => {
            let start_time = std::time::Instant::now();
            match engine.transcribe_file(&PathBuf::from(path), None) {
                Ok(result) => {
                    let duration = start_time.elapsed();
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

                    match serde_json::to_value(output) {
                        Ok(val) => Response::Ok { data: Some(val) },
                        Err(e) => Response::Error { message: e.to_string() }
                    }
                }
                Err(e) => Response::Error {
                    message: format!("Transcription failed: {}", e),
                },
            }
        }
    }
}

fn run_cli(args: Args) -> Result<()> {
    let file = args.file.context("File path required in CLI mode")?;
    let model = args.model.context("Model path required in CLI mode")?;
    
    let start_time = std::time::Instant::now();
    let mut engine = ParakeetEngine::new();

    engine
        .load_model(&model)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;

    let result = engine
        .transcribe_file(&file, None)
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let duration = start_time.elapsed();

    if args.output == "json" {
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
