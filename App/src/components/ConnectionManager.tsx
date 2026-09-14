import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface ConnectionManagerProps {
  onConnect?: () => void;
}

export function ConnectionManager({ onConnect }: ConnectionManagerProps) {
  const [ports, setPorts] = useState<string[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baudrate, setBaudrate] = useState(115200);
  const [status, setStatus] = useState<
    "idle" | "loading" | "connected" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function loadPorts() {
    setStatus("loading");
    setErrorMessage("");

    try {
      let detectedPorts: string[];

      try {
        detectedPorts = await invoke<string[]>("get_avaible_ports");
      } catch {
        detectedPorts = await invoke<string[]>("get_available_ports");
      }

      setPorts(detectedPorts);

      if (detectedPorts.length > 0) {
        setSelectedPort(detectedPorts[0]);
      }

      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setErrorMessage(String(error));
    }
  }

  async function handleConnect() {
    if (!selectedPort) {
      setStatus("error");
      setErrorMessage("No serial port selected.");
      return;
    }

    setStatus("loading");
    setErrorMessage("");

    try {
      await invoke("connect_uart", {
        port: selectedPort,
        baudrate: Number(baudrate),
      });

      setStatus("connected");
      onConnect?.();
    } catch (error) {
      setStatus("error");
      setErrorMessage(String(error));
    }
  }

  useEffect(() => {
    loadPorts();
  }, []);

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          CONNECTION
        </span>
        <button
          onClick={loadPorts}
          className="text-[10px] font-medium uppercase tracking-wider text-slate-500 hover:text-slate-300 transition"
        >
          REFRESH
        </button>
      </div>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            PORT
          </span>
          <select
            value={selectedPort}
            onChange={(event) => setSelectedPort(event.target.value)}
            className="w-full rounded bg-[#141414] border border-[#262626] px-3 py-2.5 text-sm font-mono text-slate-200 outline-none focus:border-slate-500"
          >
            {ports.length === 0 ? (
              <option value="">NO PORTS DETECTED</option>
            ) : (
              ports.map((port) => (
                <option key={port} value={port}>
                  {port}
                </option>
              ))
            )}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            BAUD RATE
          </span>
          <select
            value={baudrate}
            onChange={(event) => setBaudrate(Number(event.target.value))}
            className="w-full rounded bg-[#141414] border border-[#262626] px-3 py-2.5 text-sm font-mono text-slate-200 outline-none focus:border-slate-500"
          >
            <option value={9600}>9600</option>
            <option value={57600}>57600</option>
            <option value={115200}>115200</option>
          </select>
        </label>

        <button
          onClick={handleConnect}
          disabled={status === "loading" || !selectedPort}
          className="w-full mt-2 rounded bg-white py-3 text-xs font-bold uppercase tracking-widest text-black transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "CONNECTING..." : status === "connected" ? "CONNECTED" : "CONNECT"}
        </button>

        {errorMessage && (
          <p className="mt-2 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 font-mono text-xs text-red-400">
            {errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}
