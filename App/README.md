# EMIDSS-8 Telemetry Analysis Application

**Version:** 1.0.0 (In Development)  
**Architecture:** Tauri (Rust Backend + React/TypeScript Frontend)  

## Overview
The EMIDSS-8 application is a high-performance, asynchronous desktop GUI designed to control the EMIDSS cubesat payload via UART. It replaces the legacy Python monolithic scripts, utilizing a decoupled architecture to ensure the user interface remains completely responsive during massive binary memory dumps. 

## Prerequisites
To compile and run this project, the following build tools are required:

* **Node.js** (v18+)
* **Rust** (via `rustup`)
* **Linux Dependencies** (For Ubuntu/Pop!_OS):
  ```bash
  sudo apt update
  sudo apt install pkg-config libudev-dev build-essential

```

## Getting Started

1. Clone the repository and navigate to the project root.
2. Install the frontend dependencies:
3. 
```bash
npm install

```


3. Boot the application in development mode:
```bash
npm run tauri dev

```



---

## Codebase Documentation

As components are completed during development sprints, their specific logic and APIs are documented below.

### Backend Core: `src-tauri/src/main.rs`

**Language:** Rust

**Purpose:** Acts as the primary entry point for the backend logic. It manages the hardware I/O boundary, asynchronous threading, and the Tauri IPC (Inter-Process Communication) bridge.

#### IPC Commands (Invoked by Frontend)

* **`get_avaible_ports`**
* **Returns:** `Result<Vec<String>, String>`
* **Description:** Scans the host operating system's hardware registry for active serial ports (e.g., `COM20` or `/dev/ttyUSB0`). Returns an array of port names. *(Note: Matches the current code spelling `avaible` for frontend invocations).*


* **`connect_uart(port: String, baudrate: u32)`**
* **Returns:** `Result<(), String>`
* **Description:** Opens a native asynchronous serial stream to the specified port. Once connected, it spawns an independent background `tokio` green thread. This thread runs an infinite loop, safely buffering raw bytes from the hardware, decoding them into UTF-8 strings, and pushing them to the UI without blocking the main application thread.



#### Global Events (Emitted to Frontend)

* **Event Name:** `"uart-rx"`
* **Payload:** `String` (UTF-8 decoded telemetry data)
* **Description:** Fired by the `connect_uart` background thread whenever new data is received from the physical EMIDSS payload. The frontend listens to this event to populate the raw terminal console.



#### System Configuration

* **Window State:** Uses `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` to ensure no lingering terminal consoles appear when compiled for production on Windows.
* **Plugins:** Utilizes `tauri_plugin_opener` for native OS interactions.

---
