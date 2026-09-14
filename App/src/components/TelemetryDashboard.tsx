import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Download, LineChart as ChartIcon, AlertTriangle, Activity, Thermometer, Gauge } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
} from "recharts";

type TelemetryPoint = {
  Time: string;
  Temperature: number;
  Humidity: number;
  Pressure: number;
};

function normalizeTelemetryPayload(payload: TelemetryPoint[] | string): TelemetryPoint[] {
  const parsedPayload = typeof payload === "string" ? JSON.parse(payload) : payload;

  if (!Array.isArray(parsedPayload)) {
    throw new Error("Telemetry payload must be an array.");
  }

  return parsedPayload
    .map((point) => ({
      Time: String(point.Time),
      Temperature: Number(point.Temperature),
      Humidity: Number(point.Humidity),
      Pressure: Number(point.Pressure),
    }))
    .filter(
      (point) =>
        point.Time &&
        Number.isFinite(point.Temperature) &&
        Number.isFinite(point.Humidity) &&
        Number.isFinite(point.Pressure)
    );
}

export function TelemetryDashboard() {
  const [activeTab, setActiveTab] = useState<"timeline" | "analysis">("analysis");
  const [telemetryData, setTelemetryData] = useState<TelemetryPoint[]>([]);
  const [statusMessage, setStatusMessage] = useState("Awaiting payload memory transmission...");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const unlistenPromise = listen<TelemetryPoint[] | string>("telemetry-update", (event) => {
      try {
        const normalizedData = normalizeTelemetryPayload(event.payload);
        setTelemetryData(normalizedData);
        setStatusMessage(`${normalizedData.length} telemetry records loaded.`);
        setErrorMessage("");
      } catch (error) {
        setErrorMessage(String(error));
        setStatusMessage("Failed to parse incoming payload.");
      }
    });

    return () => {
      unlistenPromise.then((u) => u());
    };
  }, []);

  // --- DATA PROCESSING ---
  const { timelineData, analysisData, anomalies } = useMemo(() => {
    const timeline = telemetryData.map((d) => ({
      time: d.Time,
      temp: d.Temperature,
      hum: d.Humidity,
      press: d.Pressure,
      isFault: d.Humidity < 0,
    }));

    const grouped = new Map<string, { time: string; tempSum: number; humSum: number; pressSum: number; count: number; validHumCount: number }>();
    const faults: string[] = [];

    telemetryData.forEach((d) => {
      const t = d.Time;
      if (d.Humidity < 0 && !faults.includes(t)) faults.push(t);

      if (!grouped.has(t)) {
        grouped.set(t, { time: t, tempSum: 0, humSum: 0, pressSum: 0, count: 0, validHumCount: 0 });
      }

      const group = grouped.get(t)!;
      group.tempSum += d.Temperature;
      group.pressSum += d.Pressure;
      group.count += 1;

      if (d.Humidity >= 0) {
        group.humSum += d.Humidity;
        group.validHumCount += 1;
      }
    });

    const analysis = Array.from(grouped.values()).map((g) => ({
      time: g.time,
      temp: Number((g.tempSum / g.count).toFixed(3)),
      press: Number((g.pressSum / g.count).toFixed(3)),
      hum: g.validHumCount > 0 ? Number((g.humSum / g.validHumCount).toFixed(3)) : null,
    }));

    return { timelineData: timeline, analysisData: analysis, anomalies: faults };
  }, [telemetryData]);

  // --- CSV Export Logic ---
  const handleExportCSV = async () => {
    if (timelineData.length === 0) return;
    const headers = ["time", "temp", "hum", "press", "isFault"];
    const csvRows = [headers.join(",")];
    for (const row of timelineData) {
      csvRows.push(`${row.time},${row.temp},${row.hum},${row.press},${row.isFault}`);
    }
    const filename = `EMIDSS_HISTORIC_${new Date().getTime()}.csv`;
    try {
      const savedPath = await invoke("export_csv", { filename, content: csvRows.join("\n") });
      setStatusMessage(`CSV exported: ${savedPath}`);
    } catch (err) {
      const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.setAttribute("href", url);
      a.setAttribute("download", filename);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // --- CHART COMPONENT ---
  const TimelineChart = ({ title, dataKey, color, data }: any) => (
    <div className="flex flex-col h-[210px] border-b border-zinc-800/50 last:border-b-0 shrink-0">
      <div className="px-4 py-2 bg-zinc-950/30 shrink-0">
        <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">{title}</span>
      </div>
      <div className="flex-1 w-full px-2 pb-2 pt-2 min-h-[160px]">
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="2 2" stroke="#27272a" vertical={false} />
            <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickMargin={8} minTickGap={20} />
            <YAxis stroke="#52525b" fontSize={10} domain={['auto', 'auto']} width={45} tickFormatter={(val: number) => val?.toFixed ? val.toFixed(1) : String(val)} />
            <Tooltip
              contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '2px', fontSize: '12px' }}
              itemStyle={{ color: '#f4f4f5', fontFamily: 'monospace' }}
              labelStyle={{ color: '#a1a1aa', marginBottom: '4px' }}
            />
            <Line type="stepAfter" dataKey={dataKey} stroke={color} strokeWidth={1.5} dot={{ r: 1, fill: color }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  const peakTemp = analysisData.length > 0 ? Math.max(...analysisData.map(d => d.temp)).toFixed(2) : "0.00";
  const pressVariance = analysisData.length > 0
    ? Math.abs(Math.max(...analysisData.map(d => d.press)) - Math.min(...analysisData.map(d => d.press))).toFixed(2)
    : "0.00";

  return (
    <div className="flex flex-col w-full bg-[#09090b] text-zinc-300 font-sans overflow-hidden selection:bg-zinc-700 rounded border border-zinc-800/50">
      {/* HEADER */}
      <header className="h-12 border-b border-zinc-800 bg-zinc-950 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <ChartIcon size={16} className="text-zinc-400" />
          <span className="text-xs font-semibold tracking-widest text-zinc-200">EMIDSS-8 // HISTORIC TELEMETRY</span>
          <span className="text-[10px] font-mono text-zinc-500 ml-2">({statusMessage})</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setTelemetryData([]);
              setStatusMessage("Telemetry records cleared.");
            }}
            disabled={telemetryData.length === 0}
            className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            CLEAR DATA
          </button>
          <button
            onClick={handleExportCSV}
            disabled={timelineData.length === 0}
            className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download size={14} /> EXPORT CSV
          </button>
        </div>
      </header>

      {errorMessage && (
        <p className="border-b border-red-900/50 bg-red-950/30 px-4 py-2 font-mono text-xs text-red-400 shrink-0">
          {errorMessage}
        </p>
      )}

      {/* TAB NAVIGATION */}
      <div className="h-11 border-b border-zinc-800/50 bg-[#121214] flex px-4 shrink-0 gap-6">
        <button
          onClick={() => setActiveTab("timeline")}
          className={`h-full flex items-center gap-2 text-xs font-semibold tracking-widest uppercase transition-colors relative ${activeTab === "timeline" ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}
        >
          <Activity size={14} /> Raw Timeline
          {activeTab === "timeline" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
        <button
          onClick={() => setActiveTab("analysis")}
          className={`h-full flex items-center gap-2 text-xs font-semibold tracking-widest uppercase transition-colors relative ${activeTab === "analysis" ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-400"}`}
        >
          <Gauge size={14} /> Atmospheric Analysis
          {activeTab === "analysis" && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500" />}
        </button>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 min-h-[550px] overflow-y-auto">
        {telemetryData.length === 0 ? (
          <div className="flex items-center justify-center h-[400px] text-zinc-500 font-mono text-xs">
            No telemetry records loaded yet. Execute a memory read from the Operations Console.
          </div>
        ) : (
          <>
            {/* --- TAB 1: RAW TIMELINE --- */}
            {activeTab === "timeline" && (
              <div className="flex flex-col h-full">
                <TimelineChart title="Temperature (°C)" dataKey="temp" color="#f87171" data={timelineData} />
                <TimelineChart title="Relative Humidity (%)" dataKey="hum" color="#60a5fa" data={timelineData} />
                <TimelineChart title="Barometric Pressure (hPa)" dataKey="press" color="#34d399" data={timelineData} />
              </div>
            )}

            {/* --- TAB 2: ATMOSPHERIC ANALYSIS --- */}
            {activeTab === "analysis" && (
              <div className="p-6 flex flex-col gap-6">
                {/* KPI Metrics */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-[#121214] border border-zinc-800/50 p-4 rounded-sm">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <Thermometer size={14} /> <span className="text-[10px] uppercase tracking-widest font-semibold">Peak Temp</span>
                    </div>
                    <div className="text-2xl font-mono text-zinc-200">
                      {peakTemp}
                      <span className="text-sm text-zinc-500 ml-1">°C</span>
                    </div>
                  </div>
                  <div className="bg-[#121214] border border-zinc-800/50 p-4 rounded-sm">
                    <div className="flex items-center gap-2 text-zinc-500 mb-2">
                      <Gauge size={14} /> <span className="text-[10px] uppercase tracking-widest font-semibold">Pressure Variance</span>
                    </div>
                    <div className="text-2xl font-mono text-zinc-200">
                      {pressVariance}
                      <span className="text-sm text-zinc-500 ml-1">hPa Δ</span>
                    </div>
                  </div>
                  <div className={`border p-4 rounded-sm ${anomalies.length > 0 ? "bg-red-950/20 border-red-900/50" : "bg-[#121214] border-zinc-800/50"}`}>
                    <div className="flex items-center gap-2 text-red-500 mb-2">
                      <AlertTriangle size={14} /> <span className="text-[10px] uppercase tracking-widest font-semibold">Sensor Faults</span>
                    </div>
                    <div className="text-xl font-mono text-red-400">
                      {anomalies.length > 0 ? `${anomalies.length} Humidity Dropouts` : "System Nominal"}
                    </div>
                    {anomalies.length > 0 && <div className="text-[10px] text-red-500/70 mt-1 font-mono">Occurred at: {anomalies.join(", ")}</div>}
                  </div>
                </div>

                {/* Oscillation Chart (Temp vs Pressure) */}
                <div className="bg-[#121214] border border-zinc-800/50 rounded-sm flex flex-col h-[400px]">
                  <div className="px-4 py-3 border-b border-zinc-800/50">
                    <span className="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">Atmospheric Profile (Temp, Humidity & Pressure Correlation)</span>
                  </div>
                  <div className="flex-1 p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={analysisData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="time" stroke="#52525b" fontSize={10} tickMargin={8} />
                        <YAxis yAxisId="left" stroke="#f87171" fontSize={10} domain={['auto', 'auto']} orientation="left" />
                        <YAxis yAxisId="right" stroke="#34d399" fontSize={10} domain={['auto', 'auto']} orientation="right" />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '2px', fontSize: '12px' }}
                          itemStyle={{ fontFamily: 'monospace' }}
                          labelStyle={{ color: '#a1a1aa', marginBottom: '4px' }}
                        />
                        <Area yAxisId="left" type="monotone" dataKey="temp" fill="#f87171" fillOpacity={0.1} stroke="none" />
                        <Line yAxisId="left" type="monotone" dataKey="temp" stroke="#f87171" strokeWidth={2} dot={true} name="Temp (°C)" />
                        <Line yAxisId="left" type="monotone" dataKey="hum" stroke="#60a5fa" strokeWidth={2} dot={true} connectNulls={true} name="Humidity (%)" />
                        <Line yAxisId="right" type="monotone" dataKey="press" stroke="#34d399" strokeWidth={2} dot={true} name="Press (hPa)" />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}