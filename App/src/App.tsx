import { useState } from "react";
import "./App.css";
import { ConnectionManager } from "./components/ConnectionManager";
import { MissionControlPanel } from "./components/MissionControlPanel";
import { TelemetryDashboard } from "./components/TelemetryDashboard";
import { TerminalConsole } from "./components/TerminalConsole";

type Section = "operations" | "telemetry";

function App() {
  const [activeSection, setActiveSection] = useState<Section>("operations");

  return (
    <main className="min-h-screen bg-[#0e0e0e] text-slate-100 font-sans selection:bg-slate-800">
      <div className="mx-auto flex max-w-[1440px] flex-col p-6 md:p-8">
        <header className="mb-8 flex flex-col justify-between gap-4 border-b border-[#262626] pb-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3.5">
            <img src="/emidss_logo.png" alt="EMIDSS Logo" className="h-8 w-8 object-contain" />
            <h1 className="text-sm font-bold uppercase tracking-[0.25em] text-white">
              EMIDSS-8 // TELEMETRY TOOL
            </h1>
          </div>

          <nav className="flex gap-1.5 bg-[#141414] p-1 rounded border border-[#262626]">
            <button
              onClick={() => setActiveSection("operations")}
              className={`px-5 py-2 text-xs font-semibold uppercase tracking-widest rounded transition ${activeSection === "operations"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-[#1f1f1f]"
                }`}
            >
              OPERATIONS CONSOLE
            </button>
            <button
              onClick={() => setActiveSection("telemetry")}
              className={`px-5 py-2 text-xs font-semibold uppercase tracking-widest rounded transition ${activeSection === "telemetry"
                  ? "bg-white text-black font-bold shadow-sm"
                  : "text-slate-400 hover:text-white hover:bg-[#1f1f1f]"
                }`}
            >
              TELEMETRY GRAPHS
            </button>
          </nav>
        </header>

        <div className={activeSection === "operations" ? "grid grid-cols-1 gap-8 lg:grid-cols-12 items-stretch" : "hidden"}>
          <div className="flex flex-col lg:col-span-4 xl:col-span-3 rounded border border-[#262626] bg-[#121212] p-6 shrink-0 justify-between">
            <div>
              <ConnectionManager />
            </div>
            <div className="my-6 border-t border-[#262626]" />
            <div>
              <MissionControlPanel />
            </div>
          </div>

          <div className="lg:col-span-8 xl:col-span-9 rounded border border-[#262626] bg-[#121212] p-6 flex flex-col">
            <TerminalConsole />
          </div>
        </div>

        <div className={activeSection === "telemetry" ? "w-full" : "hidden"}>
          <TelemetryDashboard />
        </div>
      </div>
    </main>
  );
}

export default App;