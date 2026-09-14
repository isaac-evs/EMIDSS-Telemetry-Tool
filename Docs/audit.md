# Engineering Code Audit & Architecture Review

**Project:** EMIDSS-V UI
**Document Type:** Legacy Codebase Audit  
**Date:** May 18, 2026  
**Analyzed Target:** `EMDISSV_GUI.py` and associated scripts (`Find_Port.py`, `graphicData.py`, `mock_uart.py`)  

---

## 1. Executive Summary

A comprehensive code review of the legacy EMIDSS-V Python application reveals that the current software functions as a rudimentary laboratory prototype. However, it relies heavily on anti patterns that render it unsuitable for reliable, critical operations. The monolithic architecture tightly couples the graphical interface with synchronous hardware I/O, resulting in application freezing, data loss risks, and severe maintainability bottlenecks. 

---

## 2. Categorized Findings

### 2.1. Concurrency and Architectural Blocking 
**Severity: CRITICAL**

* **Finding 1.1: Synchronous I/O Blocking the Main Event Loop** **Description:** The application reads the serial port (`ser.readline()`) directly inside the `while True:` GUI loop. If the serial buffer backs up or `readline()` blocks awaiting a newline, the entire OS-level graphical interface freezes.  
  **Impact:** High probability of UI locking and Windows "Not Responding" errors during large memory dumps.

* **Finding 1.2: Artificial Thread Throttling** **Description:** The inclusion of `time.sleep(0.01)` inside the main UI loop is a destructive workaround. It artificially slows down the UI to prevent it from consuming 100% of the CPU—a symptom of failing to use proper background worker threads.  
  **Impact:** Sluggish user interface and delayed telemetry rendering.

* **Finding 1.3: Destructive Subprocess Spawning** **Description:** Executing `runpy.run_path('GraphicData.py')` to render plots halts the main script execution. It launches a completely separate Python execution context and renders Matplotlib in an unattached, blocking window.  
  **Impact:** Breaks application state flow; forces the user to manually close the graph window to regain control of the primary interface.

### 2.2. Hardware Communication & Protocol
**Severity: HIGH**

* **Finding 2.1: The "Double Write" Protocol Anomaly** **Description:** Control commands write the payload twice sequentially (e.g., `ser.write(b"S2201"); ser.write(b"S2201")`). This is typically a "ducttape" patch for underlying unaddressed hardware timing issues, a dirty serial buffer, or a missing ACK/NACK handshake protocol.  
  **Impact:** Unpredictable hardware state and potential command flooding.

* **Finding 2.2: Brittle Hardware Addressing** **Description:** In `Find_Port.py`, the code aggressively selects the first available port (`all_ports[0]`).   
  **Impact:** If executed on a host with no active COM ports, the software suffers an unhandled `IndexError` and crashes instantly.

* **Finding 2.3: Inconsistent Payload Encoding** **Description:** The codebase arbitrarily mixes byte literals (`b"S2201"`) and dynamically encoded strings (`("S2301" + ...).encode('utf-8')`).   
  **Impact:** High risk of silent payload corruption and makes debugging protocol mismatches highly difficult.

* **Finding 2.4: Platform- ependent Mocking Environment** **Description:** The `mock_uart.py` testing script imports the `pty` module, which is strictly Unix/POSIX only.  
  **Impact:** Breaks the local development environment for any engineer attempting to mock the hardware on a Windows machine.

### 2.3. Data Pipeline & Telemetry Processing
**Severity: HIGH**

* **Finding 3.1: Manual Data Pipeline (The "AirGap")** **Description:** The application lacks automated data ingestion. Per the internal documentation, the operator must manually copy console output and paste it into an external Excel spreadsheet before graphing can occur.  
  **Impact:** Defeats the primary purpose of an automated telemetry analysis tool and introduces massive human error risk.

* **Finding 3.2: Hardcoded Dependencies & Schema Typos** **Description:** `graphicData.py` has the target filename (`EMIDSS_V_Data.xlsx`) strictly hardcoded. Furthermore, the Pandas script queries a misspelled column: `data['Humity']`.  
  **Impact:** If the file is locked by another program, missing, or if an analyst corrects the spelling of "Humidity" in the source sheet, the application suffers a fatal crash.

### 2.4. UI/UX and Software Hygiene
**Severity: MEDIUM**

* **Finding 4.1: Destructive Asset Management (DiskWriting)** **Description:** The `resize_image` utility function opens a `.png`, resizes it, and saves a brand new file (`emidss_png.png`) to the host hard drive on every application launch.  
  **Impact:** Unnecessary disk I/O and litters the production directory with duplicate, temporary graphical assets. Assets should be processed in memory or precompiled.

* **Finding 4.2: Hardcoded Layout Topography** **Description:** The UI uses empty text strings (e.g., `sg.Text('                   ')`) to force horizontal alignment of widgets.  
  **Impact:** Highly fragile layout. If executed on a machine with a different system font, DPI scaling, or a 4K monitor, the UI topology will break entirely.

* **Finding 4.3: Nuclear Exception Handling** **Description:** If `ser.is_open` fails during startup, the application calls `exit()`, forcefully terminating the process.  
  **Impact:** Poor user experience. The application should catch the error, load the UI gracefully, and prompt the user to configure a valid COM port via the settings menu.
