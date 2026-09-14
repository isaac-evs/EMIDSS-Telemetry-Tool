import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type CommandAction = "ReadMemory" | "ReadTime" | "ResetSensor";

const missionCommands: { label: string; action: CommandAction }[] = [
  { label: "READ TIME", action: "ReadTime" },
  { label: "READ MEMORY", action: "ReadMemory" },
  { label: "FLUSH BUFFER", action: "ResetSensor" },
];

export function MissionControlPanel() {
  const [activeCommand, setActiveCommand] = useState<CommandAction | null>(null);
  const [statusMessage, setStatusMessage] = useState("Ready to send mission commands.");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleCommand(action: CommandAction) {
    setActiveCommand(action);
    setErrorMessage("");
    setStatusMessage(`Sending ${action} command...`);

    try {
      // Send semantic command to Rust. Rust maps it to the UART protocol
      await invoke("send_command", { action });

      setStatusMessage(`${action} command sent successfully.`);
    } catch (error) {
      setErrorMessage(String(error));
      setStatusMessage("Command failed.");
    } finally {
      setActiveCommand(null);
    }
  }

  return (
    <div className="flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          PAYLOAD CONTROL
        </span>
        <span className="text-[10px] font-mono uppercase text-slate-500">
          {statusMessage}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        {missionCommands.map((command) => (
          <button
            key={command.action}
            onClick={() => handleCommand(command.action)}
            disabled={activeCommand !== null}
            className="w-full rounded border border-[#262626] bg-[#1a1a1a] py-3.5 text-xs font-semibold uppercase tracking-widest text-slate-200 transition hover:bg-[#242424] hover:border-[#333333] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {activeCommand === command.action ? "SENDING..." : command.label}
          </button>
        ))}
      </div>

      {errorMessage && (
        <p className="mt-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 font-mono text-xs text-red-400">
          {errorMessage}
        </p>
      )}
    </div>
  );
}