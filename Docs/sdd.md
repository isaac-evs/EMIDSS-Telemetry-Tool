# Software Design Document (SDD)

**Project:** EMIDSS-8 UI  
**Version:** 1.0  
**Date:** May 18, 2026  

---

## 1. Introduction

### 1.1. Purpose
This document provides a comprehensive architectural overview of the refactored EMIDSS-V UI. It details the system's structural design, component responsibilities, data flow, and the rationale behind critical architectural decisions, serving as the blueprint for the engineering team.

### 1.2. Scope
This SDD covers the transition from a monolithic, synchronous Python script to a decoupled, asynchronous application utilizing the Tauri framework (Rust backend + Web frontend). It addresses hardware communication, data normalization, Inter Process Communication (IPC), and frontend rendering.

---

## 2. System Architecture Overview

The system utilizes a strictly decoupled, two tier desktop architecture facilitated by the Tauri framework. 

1. **Frontend:** Runs in the operating system's native webview. It is strictly responsible for rendering the User Interface, capturing user inputs, and visualizing JSON data payloads using web native charting libraries.
2. **Backend:** A compiled Rust binary that manages all hardware interactions (UART/Serial), binary parsing, and data aggregation. It runs independently of the frontend's rendering thread.
3. **IPC:** The secure communication layer provided by Tauri. It passes UI events (Commands) down to Rust, and pushes asynchronous data (Logs, Telemetry JSON) up to the Frontend.

---

## 3. Architectural Decision Records (ADR)

This section documents the specific engineering decisions made to resolve the bottlenecks identified in the legacy Python codebase.

### ADR 01: Adopting Tauri over PySide6 (Qt)
* **Context:** The legacy app used `PySimpleGUI`, which blocked the main thread. We required a modern, responsive UI.
* **Decision:** We selected Tauri with a Web Frontend (e.g., React/TypeScript) over PySide6.
* **Rationale:** The team consists of distinct frontend and backend roles. Tauri allows the frontend developer to leverage modern web ecosystems (CSS, Tailwind, D3.js) without fighting Qt's complex styling engine. Because the data volume is in the thousands (not millions) of rows, the IPC serialization overhead is negligible.

### ADR 02: Pure Rust Backend over Python Sidecar
* **Context:** The legacy code was written in Python. Tauri supports bundling Python as a background sidecar.
* **Decision:** We chose to bypass Python entirely and rewrite the backend parsing logic natively in Rust.
* **Rationale:** This eliminates the need for multi stage build pipelines (like freezing Python scripts with PyInstaller). It guarantees memory safety when parsing potentially corrupted serial byte streams and results in a single, highly optimized, dependency free binary executable.

### ADR 03: Asynchronous Serial I/O (`tokio-serial`)
* **Context:** The legacy app utilized a synchronous `while True:` loop with `ser.readline()`, which caused the GUI to freeze during large memory dumps.
* **Decision:** Implement a non blocking, asynchronous serial listener using the Rust `tokio` runtime.
* **Rationale:** The serial listener will run on a dedicated green thread. It buffers incoming bytes without ever blocking the Tauri main thread or the frontend webview, ensuring the UI remains perfectly responsive at all times.

### ADR 04: Replacing Pandas with Polars
* **Context:** The legacy app relied on Pandas and an external Excel file to interpolate and clean telemetry data.
* **Decision:** Utilize the `polars` crate in the Rust backend for data aggregation.
* **Rationale:** Polars is a lightning fast DataFrame library native to Rust. It allows the application to ingest the raw string stream, structure it, interpolate missing values, and serialize it to JSON entirely in memory, eliminating the fragile dependency on external `.xlsx` files.

---

## 4. Component Design

### 4.1. Frontend Components (Webview)
* **Connection Manager:** A localized UI state containing a dropdown for detected COM ports and Baud rates. Emits the `connect_uart` command to the backend.
* **Mission Control Panel:** Contains the action buttons (Read Time, Read Memory, Reset Sensor). Each button is mapped to a specific Tauri API call.
* **Terminal Console:** A scrolling text area that listens to the `uart-rx` global event from the backend, printing raw hex/string data for operator visibility.
* **Telemetry Dashboard:** The charting container (e.g., Chart.js). It listens for the `telemetry-update` event, parses the JSON payload, and updates the Temperature, Humidity, and Pressure line graphs.

### 4.2. Backend Components (Rust Core)
* **Port Manager:** Utilizes `serialport::available_ports()` to detect hardware and manages the `tokio-serial` connection state.
* **Command Dispatcher:** Receives semantic commands from the frontend (e.g., "ReadMemory") and translates them into the required byte protocols (e.g., `b"S2202"`).
* **Ingestion Buffer:** A dedicated async task that continuously reads the active serial stream, decodes UTF-8/Hex, and routes standard text to the frontend terminal and payload dumps to the Parser.
* **DataFrame Engine:** Wraps the `polars` library. Takes structured memory dumps, aligns the timestamps, cleans the dataset, and serializes it into a frontend friendly JSON structure.

---

## 5. Data Flow Specifications

### 5.1. Outbound (Command Execution)
1. User clicks "Read Memory" on the UI.
2. Frontend invokes Tauri command: `invoke('send_command', { action: 'Memory' })`.
3. Rust backend receives the payload, matches 'Memory' to `b"S2202"`.
4. Rust writes the bytes securely to the active TTY/COM port.

### 5.2. Inbound (Telemetry Ingestion)
1. `tokio-serial` thread detects incoming bytes on the COM port.
2. Bytes are buffered and decoded into strings.
3. If the string is a standard log, Rust emits a `uart-rx` event to the frontend for the Terminal view.
4. If the string is a bulk memory dump, it is routed to the Polars Engine.
5. Polars processes the data into a structured schema (Time, Temp, Hum, Press).
6. Rust serializes the Polars DataFrame to JSON and emits a `telemetry-update` event to the frontend.
7. The charting library redraws the graphs based on the new JSON data.
