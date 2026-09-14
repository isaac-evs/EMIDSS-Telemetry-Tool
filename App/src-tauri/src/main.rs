// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, Mutex};
use tokio_serial::SerialPortBuilderExt;
use polars::prelude::*;
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;

struct AppState {
    tx: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    waiting_for_response: Arc<Mutex<bool>>,
}

// Command 1: Port Enumeration
#[tauri::command]
fn get_avaible_ports() -> Result<Vec<String>, String> {
    // Scan System for active ports
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;

    // Extract the port names (ej: "COM2")
    let mut port_names = Vec::new();
    for port in ports {
        port_names.push(port.port_name);
    }

    // Include virtual test simulator port if running
    if std::path::Path::new("/tmp/emidss_sim_port").exists() && !port_names.contains(&"/tmp/emidss_sim_port".to_string()) {
        port_names.insert(0, "/tmp/emidss_sim_port".to_string());
    }

    Ok(port_names)
}

// Command 2: Async Serial Connection
#[tauri::command]
async fn connect_uart(app: AppHandle, state: tauri::State<'_, AppState>, port: String, baudrate: u32) -> Result<(), String> {
    // Drop existing connection if any
    {
        let mut tx_guard = state.tx.lock().await;
        *tx_guard = None;
    }

    // 1. Attempt to open the serial port
    let stream_pair: (Box<dyn tokio::io::AsyncRead + Unpin + Send>, Box<dyn tokio::io::AsyncWrite + Unpin + Send>) = match tokio_serial::new(&port, baudrate).open_native_async() {
        Ok(mut serial_stream) => {
            #[cfg(unix)]
            let _ = serial_stream.set_exclusive(false);
            let (r, w) = tokio::io::split(serial_stream);
            (Box::new(r), Box::new(w))
        }
        Err(e) => {
            // On macOS (Darwin) and Unix, virtual PTY devices (like /tmp/emidss_sim_port or /dev/ttys*)
            // do not support hardware serial speed ioctls (IOSSIOSPEED), causing ENOTTY ("not a typewriter").
            // Fall back to opening as an async character stream.
            if port.contains("emidss_sim_port") || port.contains("tty") || port.contains("pts") || e.to_string().contains("typewriter") || e.to_string().contains("ENOTTY") || e.to_string().contains("Inappropriate ioctl") {
                let r_file = tokio::fs::OpenOptions::new()
                    .read(true)
                    .open(&port)
                    .await
                    .map_err(|fe| format!("Failed to open port reader {}: {} (fallback error: {})", port, e, fe))?;
                let w_file = tokio::fs::OpenOptions::new()
                    .write(true)
                    .open(&port)
                    .await
                    .map_err(|fe| format!("Failed to open port writer {}: {} (fallback error: {})", port, e, fe))?;
                (Box::new(r_file), Box::new(w_file))
            } else {
                return Err(format!("Failed to open port {}: {}", port, e));
            }
        }
    };

    println!("Succesfully connected to {} at {} baud", port, baudrate);

    let (reader, mut writer) = stream_pair;
    let (tx, mut rx) = mpsc::channel::<Vec<u8>>(32);

    // Store sender in state
    {
        let mut tx_guard = state.tx.lock().await;
        *tx_guard = Some(tx);
    }

    // Spawn async writer task
    tauri::async_runtime::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if let Err(e) = writer.write_all(&bytes).await {
                eprintln!("Failed to write to serial port: {}", e);
                break;
            }
            if let Err(e) = writer.flush().await {
                eprintln!("Failed to flush serial port: {}", e);
                break;
            }
        }
    });

    let waiting_flag = state.waiting_for_response.clone();
    let app_clone = app.clone();

    // Spawn async reader task with defensive parsing
    tauri::async_runtime::spawn(async move {
        let mut buf_reader = BufReader::new(reader);
        let mut byte_buf = Vec::new();
        let mut in_dump = false;
        let mut dump_lines = Vec::new();

        loop {
            byte_buf.clear();
            match buf_reader.read_until(b'\n', &mut byte_buf).await {
                Ok(0) => {
                    println!("Serial port closed.");
                    let _ = app_clone.emit("uart-rx", "[STATUS] Serial port disconnected.");
                    break;
                }
                Ok(_) => {
                    // Data received -> clear response timeout flag
                    {
                        let mut waiting = waiting_flag.lock().await;
                        *waiting = false;
                    }

                    // Defensive conversion: lossy UTF-8 prevents crash on corrupted bytes
                    let line = String::from_utf8_lossy(&byte_buf).trim().to_string();
                    if line.is_empty() {
                        continue;
                    }

                    // Implement a parser block to recognize bulk memory dump
                    if line == "BEGIN_DUMP" {
                        in_dump = true;
                        dump_lines.clear();
                        continue;
                    } else if line == "END_DUMP" {
                        in_dump = false;
                        if let Err(e) = process_and_emit_dump(&app_clone, &dump_lines) {
                            eprintln!("Dirty/corrupted dump data ignored: {}", e);
                            let _ = app_clone.emit("uart-error", format!("Corrupted dump ignored: {}", e));
                        }
                        continue;
                    }

                    if in_dump {
                        dump_lines.push(line);
                    } else {
                        if let Err(e) = app_clone.emit("uart-rx", line.clone()) {
                            eprintln!("Failed to emit to frontend: {}", e);
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Defensive catch: Serial read error (dirty data): {}", e);
                    let _ = app_clone.emit("uart-error", format!("Dirty hardware stream: {}", e));
                    if e.kind() == std::io::ErrorKind::BrokenPipe
                        || e.kind() == std::io::ErrorKind::ConnectionReset
                        || e.kind() == std::io::ErrorKind::UnexpectedEof
                    {
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            }
        }
    });

    Ok(())
}

// Command 3: Send Command with Timeout Mechanism
#[tauri::command]
async fn send_command(app: AppHandle, state: tauri::State<'_, AppState>, action: String) -> Result<(), String> {
    let payload_bytes = match action.as_str() {
        "Memory" | "ReadMemory" => b"S2202\n".to_vec(),
        "Time" | "ReadTime" => b"S2201\n".to_vec(),
        "Reset" | "ResetSensor" => b"S2203\n".to_vec(),
        other => format!("{}\n", other).as_bytes().to_vec(),
    };

    let tx = {
        let guard = state.tx.lock().await;
        match &*guard {
            Some(sender) => sender.clone(),
            None => return Err("UART port is not connected".to_string()),
        }
    };

    {
        let mut waiting = state.waiting_for_response.lock().await;
        *waiting = true;
    }

    tx.send(payload_bytes).await.map_err(|e| format!("Failed to send command: {}", e))?;

    let waiting_flag = state.waiting_for_response.clone();
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let waiting = waiting_flag.lock().await;
        if *waiting {
            let error_msg = format!("Timeout: No hardware response after sending command '{}'", action);
            eprintln!("{}", error_msg);
            let _ = app_clone.emit("uart-error", &error_msg);
            let _ = app_clone.emit("uart-rx", format!("[ERROR] {}", error_msg));
        }
    });

    Ok(())
}

// Polars parsing and interpolation with defensive Result/Option matching
fn process_and_emit_dump(app: &AppHandle, lines: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let mut times = Vec::new();
    let mut temps: Vec<Option<f64>> = Vec::new();
    let mut hums: Vec<Option<f64>> = Vec::new();
    let mut press: Vec<Option<f64>> = Vec::new();

    for line in lines {
        let parts: Vec<&str> = line.split(',').collect();
        if parts.len() >= 5 {
            let hour = parts[0].trim();
            let min = parts[1].trim();
            if let (Ok(h), Ok(m)) = (hour.parse::<u32>(), min.parse::<u32>()) {
                times.push(format!("{:02}:{:02}", h, m));
                temps.push(parts[2].trim().parse::<f64>().ok());
                hums.push(parts[3].trim().parse::<f64>().ok());
                press.push(parts[4].trim().parse::<f64>().ok());
            }
        } else if parts.len() == 4 {
            let t = parts[0].trim();
            if !t.is_empty() {
                times.push(t.to_string());
                temps.push(parts[1].trim().parse::<f64>().ok());
                hums.push(parts[2].trim().parse::<f64>().ok());
                press.push(parts[3].trim().parse::<f64>().ok());
            }
        }
    }

    if times.is_empty() {
        return Err("No valid telemetry rows parsed from dump".into());
    }

    let time_s = Series::new("Time".into(), times);
    let temp_s = Series::new("Temperature".into(), temps);
    let hum_s = Series::new("Humidity".into(), hums);
    let press_s = Series::new("Pressure".into(), press);

    let df = DataFrame::new(vec![time_s.into(), temp_s.into(), hum_s.into(), press_s.into()])?;
    
    let lf = df.lazy().with_columns([
        col("Temperature").forward_fill(None),
        col("Humidity").forward_fill(None),
        col("Pressure").forward_fill(None),
    ]);
    
    let clean_df = lf.collect()?;

    let mut json_data = Vec::new();
    let times_col = match clean_df.column("Time") {
        Ok(c) => c.str().ok(),
        Err(_) => None,
    };
    let temps_col = match clean_df.column("Temperature") {
        Ok(c) => c.f64().ok(),
        Err(_) => None,
    };
    let hums_col = match clean_df.column("Humidity") {
        Ok(c) => c.f64().ok(),
        Err(_) => None,
    };
    let press_col = match clean_df.column("Pressure") {
        Ok(c) => c.f64().ok(),
        Err(_) => None,
    };

    for i in 0..clean_df.height() {
        let time_val = times_col.and_then(|c| c.get(i)).unwrap_or("");
        let temp_val = temps_col.and_then(|c| c.get(i)).unwrap_or(0.0);
        let hum_val = hums_col.and_then(|c| c.get(i)).unwrap_or(0.0);
        let press_val = press_col.and_then(|c| c.get(i)).unwrap_or(0.0);

        json_data.push(json!({
            "Time": time_val,
            "Temperature": temp_val,
            "Humidity": hum_val,
            "Pressure": press_val
        }));
    }

    app.emit("telemetry-update", json_data)?;

    Ok(())
}

// Command 4: Export CSV directly to user filesystem
#[tauri::command]
fn export_csv(app: AppHandle, filename: String, content: String) -> Result<String, String> {
    // Tauri's path resolver reads the OS's actual Downloads/home location
    // (SHGetKnownFolderPath on Windows, HOME on macOS/Linux) instead of the
    // HOME env var, which isn't set on Windows and would silently fall back
    // to the current working directory there.
    let path = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from(".")));

    let file_path = path.join(&filename);
    std::fs::write(&file_path, content).map_err(|e| format!("Failed to save CSV file: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

// Main Builder
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            tx: Mutex::new(None),
            waiting_for_response: Arc::new(Mutex::new(false)),
        })
        .invoke_handler(tauri::generate_handler![get_avaible_ports, connect_uart, send_command, export_csv])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
