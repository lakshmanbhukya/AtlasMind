import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Clock, Brain, Search, Download, ChevronLeft, BarChart2, ChevronDown, FileJson, FileSpreadsheet, Loader2, Database } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { exportQueryResults, fetchSchema } from "../services/api";
import { useSchema } from "../hooks/useSchema";

/**
 * Convert results array to CSV string.
 */
function arrayToCsv(results) {
  if (!results || results.length === 0) return "";
  const headers = Object.keys(results[0]);
  const escape = (val) => {
    const s = String(val ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = results.map((row) => headers.map((h) => escape(row[h])).join(","));
  return [headers.join(","), ...rows].join("\n");
}

/**
 * ExportDropdown — dropdown with JSON + CSV export options.
 */
function ExportDropdown({ lastMessage, exporting, onExport }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const downloadCsv = useCallback(() => {
    if (!lastMessage?.results?.length) return;
    const csv = arrayToCsv(lastMessage.results);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `atlasmind-export-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }, [lastMessage]);

  const handleJsonExport = () => {
    onExport();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        className="w-full gap-2 text-xs border-border/50 hover:bg-accent justify-between"
        size="sm"
        onClick={() => setOpen(!open)}
        disabled={exporting}
      >
        <span className="flex items-center gap-2">
          <Download className="h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export Results"}
        </span>
        <ChevronDown className={cn("h-3 w-3 transition-transform duration-200", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-white/10 bg-popover/95 backdrop-blur-xl shadow-lg overflow-hidden animate-atlas-scale-in">
          <button
            onClick={handleJsonExport}
            disabled={exporting}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-popover-foreground hover:bg-white/5 transition-colors"
          >
            <FileJson className="h-3.5 w-3.5 text-primary" />
            Download as JSON
          </button>
          <button
            onClick={downloadCsv}
            disabled={!lastMessage?.results?.length}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-popover-foreground hover:bg-white/5 transition-colors border-t border-white/5"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-chart-2" />
            Download as CSV
          </button>
        </div>
      )}
    </div>
  );
}

const CHART_COLORS = [
  "hsl(var(--primary))",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
];

/**
 * Build chart-ready data from the result array.
 * Tries to find numeric fields and a label field automatically.
 */
function buildChartData(results) {
  if (!results || results.length === 0) return null;

  const first = results[0];
  const keys = Object.keys(first);
  if (keys.length === 0) return null;

  // Find the first numeric key (value) and first string/id key (label)
  const valueKey = keys.find((k) => typeof first[k] === "number");
  const labelKey = keys.find(
    (k) => k !== valueKey && (typeof first[k] === "string" || k === "_id")
  );

  if (!valueKey) return null;

  return {
    data: results.slice(0, 10).map((row) => ({
      label: labelKey ? String(row[labelKey] ?? row._id ?? "—") : String(row._id ?? "—"),
      value: row[valueKey],
    })),
    valueKey,
    labelKey,
  };
}

/**
 * AtlasAnalyticsInspector — Right panel Query Inspector.
 *
 * Props:
 *   lastMessage — latest assistant message from useChat (contains real metadata)
 *
 * When lastMessage is available:
 *   - Shows real executionTimeMs, confidenceScore, similarQueriesCount
 *   - Shows generated MQL pipeline
 *   - Builds chart from result array using detected chart type
 * When no query has run yet: shows a clean empty state — no fake data.
 */
export default function AtlasAnalyticsInspector({ lastMessage }) {
  const [collapsed, setCollapsed] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Derive stats from lastMessage when available
  const execTime   = lastMessage?.executionTimeMs   != null ? `${lastMessage.executionTimeMs}ms` : "—";
  const confidence = lastMessage?.confidenceScore   != null ? `${lastMessage.confidenceScore}%`  : "—";
  const similar    = lastMessage?.similarQueriesCount != null ? String(lastMessage.similarQueriesCount) : "—";

  // MQL: use real pipeline if available
  const mqlToShow = lastMessage?.pipeline?.length > 0
    ? JSON.stringify(lastMessage.pipeline, null, 2)
    : null;

  // Chart: build from real results
  const chartInfo = lastMessage?.results?.length > 0
    ? buildChartData(lastMessage.results)
    : null;

  const chartType = lastMessage?.chartType || "bar";

  const { 
    schema, 
    isLoading: schemaLoading,
    expandedCollections,
    toggleCollection 
  } = useSchema();

  const collections = schema?.collections || [];
  const [schemaSearch, setSchemaSearch] = useState("");

  const filteredSchema = useMemo(() => {
    if (!schemaSearch.trim()) return collections;
    const q = schemaSearch.toLowerCase();
    return collections.filter(c => c.name.toLowerCase().includes(q));
  }, [collections, schemaSearch]);

  // Export: POST to /api/query/export
  const handleExport = async () => {
    if (exporting || !lastMessage) return;
    setExporting(true);
    try {
      const payload = {
        query:      lastMessage?.naturalLanguage || "",
        pipeline:   lastMessage?.pipeline || [],
        collection: lastMessage?.collection || "",
        results:    lastMessage?.results   || [],
      };
      const exportData = await exportQueryResults(payload);

      // Trigger browser download
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `atlasmind-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("[Inspector] Export failed:", err.message);
    } finally {
      setExporting(false);
    }
  };

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-10 border-l border-white/5 bg-background/40 backdrop-blur-3xl flex items-center justify-center hover:bg-white/5 transition-all shrink-0 hover:shadow-[0_0_15px_rgba(0,237,100,0.1)]"
        title="Expand Inspector"
      >
        <ChevronLeft className="h-4 w-4 text-muted-foreground" />
      </button>
    );
  }

  return (
    <aside className="w-96 border-l border-white/5 bg-background/80 backdrop-blur-xl flex flex-col h-full animate-atlas-slide-in-right shrink-0 shadow-[-10px_0_40px_rgba(0,0,0,0.3)]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/5 bg-white/5">
        <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-muted-foreground/60">
          Query Inspector
        </span>
        <button
          onClick={() => setCollapsed(true)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Collapse"
        >
          <ChevronLeft className="h-4.5 w-4.5 rotate-180" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* ── Empty state when no query has run yet ── */}
        {!lastMessage ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12 gap-5">
            <div className="relative flex items-center justify-center w-20 h-20 rounded-[28px] bg-gradient-to-br from-white/10 to-transparent border border-white/10 shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-xl">
              <BarChart2 className="h-8 w-8 text-primary shadow-[0_0_15px_rgba(0,237,100,0.4)]" />
            </div>
            <p className="text-[16px] font-display font-bold text-foreground">Inspector Ready</p>
            <p className="text-[13px] text-muted-foreground/60 max-w-[240px] leading-relaxed">
              Run a query to see execution time, confidence scores, and visualizations.
            </p>
          </div>
        ) : (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: Clock,  label: "Exec Time",  value: execTime,   title: "Query execution time" },
                { icon: Brain,  label: "Confidence", value: confidence, title: "AI confidence score"   },
                { icon: Search, label: "Similar",    value: similar,    title: "Few-shot examples used" },
              ].map((stat) => (
                <div key={stat.label} className="atlas-glass rounded-[18px] p-3 text-center border border-white/5" title={stat.title}>
                  <stat.icon className="h-4 w-4 mx-auto text-primary mb-1.5" />
                  <p className="text-sm font-bold text-foreground">{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground/60 font-medium uppercase tracking-wider">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* ─── Database Schema Explorer ─── */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50">
                  Database Schema
                </span>
                {schemaLoading && <Loader2 className="h-3 w-3 animate-spin text-primary/40" />}
              </div>

              {/* Mini Search for schema */}
              <div className="relative group">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/30 group-focus-within:text-primary/50 transition-colors" />
                <input
                  type="text"
                  value={schemaSearch}
                  onChange={(e) => setSchemaSearch(e.target.value)}
                  placeholder="Filter collections…"
                  className="w-full bg-white/[0.03] border border-white/5 rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/20 outline-none focus:border-primary/20 focus:bg-white/[0.06] transition-all"
                />
              </div>

              <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
                {filteredSchema.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/40 text-center py-4 italic">
                    {schemaSearch ? "No matching collections" : "No schema data"}
                  </p>
                ) : (
                  filteredSchema.map((c) => (
                    <div key={c.name} className="atlas-glass rounded-xl border border-white/[0.03] overflow-hidden transition-all">
                      <button
                        onClick={() => toggleCollection(c.name)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Database className="h-3 w-3 text-primary/50" />
                          <span className="font-mono text-[11px] font-medium truncate">{c.name}</span>
                        </div>
                        <ChevronDown className={cn("h-3 w-3 text-muted-foreground/20 transition-transform", expandedCollections[c.name] && "rotate-180")} />
                      </button>
                      
                      {expandedCollections[c.name] && (
                        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-white/[0.02] animate-atlas-slide-in-top">
                          {c.fields?.map((f) => (
                            <div key={f.name} className="flex flex-col gap-0.5">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-foreground/70 font-medium truncate">{f.name}</span>
                                <span className="text-[9px] text-muted-foreground/30 font-bold uppercase">{f.type}</span>
                              </div>
                              {f.sample && (
                                <span className="text-[10px] text-muted-foreground/40 italic truncate pl-2 border-l border-white/5">
                                  e.g. {String(f.sample)}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="h-px bg-white/5 my-2" />

            {/* Generated MQL */}
            {mqlToShow && (
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Generated MQL
                </span>
                <pre className="mt-2 rounded-[12px] bg-black/40 border border-white/5 p-3 text-[11px] font-mono text-primary/90 overflow-x-auto leading-relaxed max-h-48 shadow-inner">
                  <code>{mqlToShow}</code>
                </pre>
              </div>
            )}

            {/* Results chart */}
            {chartInfo ? (
              <div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Query Results
                  <span className="ml-1 text-muted-foreground/60 normal-case font-normal">
                    ({lastMessage.results.length} rows)
                  </span>
                </span>
                <div className="mt-2 bg-gradient-to-br from-white/5 to-transparent border border-white/5 rounded-[16px] p-3 shadow-sm backdrop-blur-md">
                  <ResponsiveContainer width="100%" height={160}>
                    {chartType === "line" ? (
                      <LineChart data={chartInfo.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                        <Tooltip cursor={false} contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                        <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ fill: "hsl(var(--primary))" }} />
                      </LineChart>
                    ) : chartType === "pie" ? (
                      <PieChart>
                        <Pie data={chartInfo.data} dataKey="value" nameKey="label" cx="50%" cy="50%" outerRadius={60}>
                          {chartInfo.data.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                      </PieChart>
                    ) : (
                      <BarChart data={chartInfo.data}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
                        <YAxis tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v} />
                        <Tooltip cursor={false} contentStyle={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", fontSize: 11 }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {chartInfo.data.map((_, i) => (
                            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>
            ) : lastMessage?.results?.length === 0 ? (
              <div className="text-center py-4 text-[12px] text-muted-foreground atlas-glass rounded-xl">
                Query returned 0 results
              </div>
            ) : null}

            {/* Result count when chart isn't renderable (no numeric fields) */}
            {lastMessage?.results?.length > 0 && !chartInfo && (
              <div className="text-center py-4 text-[12px] text-muted-foreground atlas-glass rounded-xl">
                {lastMessage.results.length} results — no numeric fields to chart
              </div>
            )}

            {/* Export dropdown — JSON + CSV */}
            <ExportDropdown
              lastMessage={lastMessage}
              exporting={exporting}
              onExport={handleExport}
            />
          </>
        )}
      </div>
    </aside>
  );
}
