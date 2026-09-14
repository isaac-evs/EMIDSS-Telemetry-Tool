#!/usr/bin/env python3
"""
EMIDSS-8 Hardware Telemetry Simulator & Data Injector

This script creates a virtual serial port pair (/tmp/emidss_sim_port) that behaves
exactly like physical EMIDSS-8 flight module hardware communicating over UART.

Usage:
    python3 test/inject_data.py
"""

import os
import pty
import select
import sys
import time
import tty

SIM_PORT_SYMLINK = "/tmp/emidss_sim_port"
SAMPLE_DATA_FILE = os.path.join(os.path.dirname(__file__), "sample_data.tsv")


def load_sample_dump_lines():
    if not os.path.exists(SAMPLE_DATA_FILE):
        print(f"[ERROR] Sample data file not found at: {SAMPLE_DATA_FILE}")
        return []

    lines = []
    with open(SAMPLE_DATA_FILE, "r") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if not line or i == 0:  # skip empty or header row
                continue
            parts = line.split()
            if len(parts) >= 5:
                # Convert tab-separated parts to CSV format expected by Rust parser
                csv_line = f"{parts[0]},{parts[1]},{parts[2]},{parts[3]},{parts[4]}\n"
                lines.append(csv_line.encode("utf-8"))
    return lines


def send_memory_dump(master_fd, dump_lines):
    print("\n[SIMULATOR] Initiating bulk telemetry memory dump...")
    os.write(master_fd, b"[SIM] Memory read request received. Preparing transmission...\n")
    time.sleep(0.1)

    os.write(master_fd, b"BEGIN_DUMP\n")
    for line in dump_lines:
        os.write(master_fd, line)
        time.sleep(0.01)  # realistic hardware serial transmission delay
    os.write(master_fd, b"END_DUMP\n")

    os.write(master_fd, b"[SIM] Memory dump transmission completed successfully.\n")
    print(f"[SIMULATOR] Transmitted {len(dump_lines)} telemetry records to UI!")


def main():
    dump_lines = load_sample_dump_lines()
    if not dump_lines:
        print("[ERROR] No valid dump lines parsed.")
        return

    # Create pseudo-terminal pair
    master_fd, slave_fd = pty.openpty()
    try:
        tty.setraw(slave_fd)
    except Exception as e:
        print(f"[WARNING] Could not set slave PTY to raw mode: {e}")
    slave_name = os.ttyname(slave_fd)

    # Create symlink for predictable UI port discovery
    if os.path.exists(SIM_PORT_SYMLINK):
        try:
            os.remove(SIM_PORT_SYMLINK)
        except Exception:
            pass

    try:
        os.symlink(slave_name, SIM_PORT_SYMLINK)
    except Exception as e:
        print(f"[WARNING] Could not create symlink {SIM_PORT_SYMLINK}: {e}")

    # On Linux, closing slave_fd allows Tauri app to acquire exclusive lock.
    # On macOS (Darwin), slave_fd MUST stay open or macOS revokes the PTY causing ENOTTY (not a typewriter).
    if sys.platform != "darwin":
        try:
            os.close(slave_fd)
        except Exception:
            pass

    print("=" * 68)
    print(" [EMIDSS-8 Hardware Simulator] Virtual Serial Port Active")
    print(f" Port Path: {SIM_PORT_SYMLINK} -> ({slave_name})")
    print("=" * 68)
    print(" Instructions:")
    print(" 1. In the EMIDSS-8 UI, click 'REFRESH' under Connection Setup.")
    print(f" 2. Select '{SIM_PORT_SYMLINK}' and click 'CONNECT'.")
    print(" 3. Click 'READ MEMORY' under Payload Control to request dump.")
    print("    (Or press [ENTER] in this terminal window to manually trigger dump)")
    print("=" * 68)
    print("\nListening for incoming UART commands... (Press Ctrl+C to exit)\n")

    try:
        while True:
            rlist, _, _ = select.select([master_fd, sys.stdin], [], [], 0.5)

            for fd in rlist:
                if fd == sys.stdin:
                    sys.stdin.readline()
                    send_memory_dump(master_fd, dump_lines)

                elif fd == master_fd:
                    try:
                        data = os.read(master_fd, 1024)
                        if not data:
                            continue
                        command = data.decode("utf-8", errors="ignore").strip()
                        print(f"[RX COMMAND] Received hardware command: {command!r}")

                        if "S2202" in command or "Memory" in command:
                            send_memory_dump(master_fd, dump_lines)
                        elif "S2201" in command or "Time" in command:
                            now = time.strftime("%H:%M:%S")
                            os.write(master_fd, f"[RTC] Flight module system time: {now}\n".encode("utf-8"))
                        elif "S2203" in command or "Reset" in command:
                            os.write(master_fd, b"[ACK] Sensor buffer reset successful.\n")
                        else:
                            os.write(master_fd, f"[ACK] Command '{command}' acknowledged.\n".encode("utf-8"))
                    except OSError:
                        break
    except KeyboardInterrupt:
        print("\n[SIMULATOR] Shutting down virtual hardware...")
    finally:
        if os.path.exists(SIM_PORT_SYMLINK):
            try:
                os.remove(SIM_PORT_SYMLINK)
            except Exception:
                pass
        try:
            os.close(master_fd)
        except Exception:
            pass
        try:
            os.close(slave_fd)
        except Exception:
            pass
        print("[SIMULATOR] Closed cleanly.")


if __name__ == "__main__":
    main()
