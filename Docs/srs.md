# Software Requirements Specification (SRS)

**Project:** EMIDSS-8 UI  
**Version:** 1.0  
**Date:** May 18, 2026  

---

## 1. Introduction

### 1.1. Purpose
The purpose of this document is to define the functional, non functional, and structural specifications for refactoring the legacy EMIDSS-V Python GUI. The new system will be a high performance, asynchronous desktop application designed to control the cubesat payload via UART and visualize post launch memory data safely and efficiently.

### 1.2. Scope
The system is a standalone desktop application utilizing a Tauri framework with a Rust backend and a modern web frontend. It replaces the legacy `PySimpleGUI` and `matplotlib` stack to eliminate UI blocking and manual data pipelines.

**In Scope:**
* Asynchronous UART/Serial connection management via Rust (`tokio-serial`).
* Automated ingestion, parsing, and cleaning of raw telemetry data streams into memory (bypassing manual Excel sheets).
* Real time Inter Process Communication (IPC) bridge sending processed JSON payloads to the frontend.
* Interactive, hardware accelerated data visualization dashboard (e.g., via Chart.js or D3.js).
* Cross platform, single binary compilation.

**Out of Scope:**
* Cloud synchronization or external database hosting (the app remains strictly offline/local).

### 1.3. Definitions
| Term | Definition |
|---|---|
| **Tauri** | A framework for building tiny, fast binaries for all major desktop platforms using web technologies for the frontend and Rust for the backend. |
| **IPC Bridge** | InterProcess Communication; the protocol Tauri uses to securely pass JSON messages between the Rust backend and the web frontend. |
| **Tokio** | An asynchronous runtime for the Rust programming language, used to handle non blocking serial port polling. |
| **Polars** | A lightnin fast DataFrame library implemented in Rust, used as a high performance replacement for Python's Pandas. |

---

## 2. General Description

### 2.1. Product Perspective
The system operates as an offline, single executable desktop application. It interfaces directly with local hardware (COM/TTY ports) to communicate with the EMIDSS payload or mock testing devices. The UI relies on the host operating system's native webview.

### 2.2. System Actors
| Actor | Role |
|---|---|
| **Mission Operator** | Configures UART parameters, sends execution commands (e.g., Read Time, Reset Memory), and monitors raw hex output. |
| **Data Analyst** | Utilizes the interactive dashboard to zoom, pan, and analyze time series environmental data (Temperature, Humidity, Pressure). |

### 2.3. Design Principles & Assumptions
* **Total Decoupling:** The UI (Frontend) and the business logic (Backend) are strictly separated. If the frontend freezes, the Rust backend continues listening to the serial port safely.
* **Non Blocking I/O:** Serial polling will never block the main thread.
* **Automated Pipeline:** The system assumes that raw memory data can be algorithmically parsed directly from the serial stream, eliminating the need for intermediary Excel file generation.

---

## 3. Specific Requirements

### 3.1. Functional Requirements

**FR01 — Asynchronous Serial Connection**
* **Process:** The system exposes an interface to select a COM port and Baudrate. The Rust backend uses `tokio-serial` to establish a persistent, asynchronous connection.
* **Output:** Connection state (Connected/Disconnected) is emitted to the frontend via IPC to update the UI indicators without blocking.

**FR02 — Command Transmission Engine**
* **Process:** When a user triggers an action (e.g., "Read Memory", "Reset Sensor", or "Raw Command"), the frontend sends a strict command identifier to the Rust backend.
* **Output:** Rust translates the identifier into the required byte/string sequences (e.g., `b"S2203"`) and transmits it over the UART port securely.

**FR03 — Automated Telemetry Ingestion and Parsing**
* **Process:** The Rust backend continuously listens for incoming byte streams. Instead of polling in a GUI loop, a dedicated green thread buffers and decodes the UTF-8/Hex data.
* **Output:** Raw string data is emitted to the frontend console for logging. Recognized memory dump patterns are routed to the Data Aggregator (FR04).

**FR04 — Data Aggregation and Normalization (Polars)**
* **Process:** Upon receiving a memory read command, the Rust backend captures the dataset, interpolates missing values, and structures the time, temperature, humidity, and pressure fields into a `Polars` DataFrame in memory.
* **Output:** The backend serializes the structured DataFrame into a compressed JSON payload.

**FR05 — Interactive Data Visualization**
* **Process:** The frontend receives the structured JSON payload via the IPC bridge.
* **Output:** A modern charting library renders the three primary telemetry plots (Temperature, Humidity, Pressure vs. Time). The user can smoothly zoom, pan, and hover over individual data points without lag.

**FR06 — Configuration & Logging Display**
* **Process:** The frontend maintains a designated "Raw Output" terminal view that displays serial echo responses and system logs.
* **Output:** Terminal features auto scrolling, clear screen functionality, and color coded status indicators (e.g., errors in red, data in blue).

### 3.2. Non Functional Requirements & Acceptance Criteria

**NFR01 — Thread Safe Execution**
* **Criterion:** Simulating a massive, sudden influx of serial data (e.g., a 10MB continuous memory dump) must result in exactly 0 dropped frames or UI stuttering on the frontend. The application must remain responsive to clicks while receiving data.

**NFR02 — Deployment Simplicity**
* **Criterion:** The final build process must output a single, standalone executable (e.g., `.exe` for Windows) under 25MB in size, requiring zero external dependencies or runtimes installed by the user.

**NFR03 — Memory Safety**
* **Criterion:** By utilizing Rust's strict compiler checks, the application must be immune to buffer overflows or memory leaks when parsing corrupted or unexpected raw UART byte streams.

---
