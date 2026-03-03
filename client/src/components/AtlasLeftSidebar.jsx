import { useState, useEffect, useMemo } from "react";
import { Plus, MessageSquare, LayoutDashboard, ChevronDown, Database, Loader2, AlertCircle, Search, X, RefreshCw, Hash, Type, Eye } from "lucide-react";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";
import { fetchQueryHistory, fetchDashboard } from "../services/api";
import { useSchema } from "../hooks/useSchema";

/**
 * AtlasLeftSidebar — Fixed left sidebar with REAL data from backend.
 *
 * - Recent queries: GET /api/query/history (with live search filter)
 * - Pinned Dashboards: GET /api/dashboard
 * - Collections: GET /api/schema (real collection names + document counts)
 */
export default function AtlasLeftSidebar({ onNewQuery, activeView, onViewChange, pins = [] }) {
  const [recentOpen,   setRecentOpen]   = useState(true);
  const [dashOpen,     setDashOpen]     = useState(false);
  const [collOpen,     setCollOpen]     = useState(true); 
  const [history,      setHistory]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [searchQuery,  setSearchQuery]  = useState("");

  const { 
    schema, 
    isLoading: schemaLoading, 
    error: schemaError,
    expandedCollections,
    toggleCollection,
    refreshSchema
  } = useSchema();

  // Fetch history + dashboards on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [hist] = await Promise.all([
          fetchQueryHistory().catch(() => []),
        ]);
        if (!cancelled) {
          setHistory(hist);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const collections = schema?.collections || [];

  // Filter history by search query
  const filteredHistory = useMemo(() => {
    if (!searchQuery.trim()) return history;
    const q = searchQuery.toLowerCase();
    return history.filter((item) =>
      item.query?.toLowerCase().includes(q)
    );
  }, [history, searchQuery]);

  return (
    <aside className="w-64 border-r border-white/5 bg-background/80 backdrop-blur-xl flex flex-col h-full shrink-0 shadow-[4px_0_30px_rgba(0,0,0,0.3)]">
      {/* New Query button */}
      <div className="p-4 pb-3">
        <Button
          className="w-full gap-2 rounded-xl bg-primary text-primary-foreground font-bold shadow-[0_0_15px_rgba(0,237,100,0.3)] hover:shadow-[0_0_25px_rgba(0,237,100,0.5)] transition-all h-10"
          size="sm"
          onClick={onNewQuery}
        >
          <Plus className="h-4 w-4 stroke-[3px]" />
          New Query
        </Button>
      </div>

      {/* Search bar */}
      <div className="px-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search queries…"
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-8 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 focus:bg-white/[0.08] transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* Recent Chats */}
        <div className="mt-2">
          <Collapsible open={recentOpen} onOpenChange={setRecentOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/70 hover:text-foreground transition-colors">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                Recent Chats
                {history.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/40 font-mono">
                    [{filteredHistory.length}]
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform duration-200", recentOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 mt-1">
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : filteredHistory.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-muted-foreground">
                  {searchQuery ? "No matching queries" : "No queries yet"}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {filteredHistory.map((item) => (
                    <button
                      key={item.id}
                      className={cn(
                        "w-full flex items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-sidebar-accent",
                        (activeView === 'chat' && item.active) && "bg-sidebar-accent"
                      )}
                      onClick={() => {
                        onViewChange('chat');
                        // Optional: trigger navigation to specific message if item has ID
                      }}
                    >
                      <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sidebar-foreground text-[13px]">{item.query}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{item.time}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Pinned Dashboards */}
        <div className="mt-4">
          <Collapsible open={dashOpen} onOpenChange={setDashOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              <div className="flex items-center gap-1.5">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Pinned Dashboards
              </div>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform duration-200", dashOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5">
              {pins.length === 0 ? (
                <p className="px-3 py-1.5 text-[12px] text-muted-foreground">No pinned dashboards</p>
              ) : (
                pins.map((d) => (
                  <button
                    key={d._id || d.id}
                    onClick={() => onViewChange('dashboard')}
                    className={cn(
                      "w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-sidebar-accent truncate",
                      activeView === 'dashboard' ? "bg-primary/10 text-primary font-medium" : "text-sidebar-foreground"
                    )}
                  >
                    {d.name || d.query}
                  </button>
                ))
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Collections — live from GET /api/schema */}
        <div className="mt-2">
          <Collapsible open={collOpen} onOpenChange={setCollOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-2 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors">
              <div className="flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5" />
                Collections
              </div>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform duration-200", collOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5">
              {schemaLoading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                </div>
              ) : schemaError ? (
                <div className="px-3 py-2">
                  <div className="flex items-center gap-1.5 text-[12px] text-red-400 mb-2">
                    <AlertCircle className="h-3 w-3" />
                    {schemaError}
                  </div>
                  <button
                    onClick={() => { setSchemaError(null); setCollections([]); }}
                    className="text-[11px] text-primary hover:underline"
                  >
                    Retry
                  </button>
                </div>
              ) : collections.length === 0 ? (
               <div className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] text-muted-foreground">
                  <AlertCircle className="h-3 w-3" />
                  No collections found
                </div>
              ) : (
                <div className="space-y-1">
                  {collections.map((c) => (
                    <Collapsible 
                      key={c.name}
                      open={!!expandedCollections[c.name]}
                      onOpenChange={() => toggleCollection(c.name)}
                    >
                      <CollapsibleTrigger className="w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] text-sidebar-foreground hover:bg-sidebar-accent group transition-colors">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <Database className="h-3 w-3 text-primary/60" />
                          <span className="font-mono text-[12px] truncate">{c.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground/50 font-mono">
                            {c.documentCount != null
                              ? c.documentCount >= 1000
                                ? `${(c.documentCount / 1000).toFixed(1)}k`
                                : String(c.documentCount)
                              : "—"}
                          </span>
                          <ChevronDown className={cn("h-3 w-3 text-muted-foreground/30 transition-transform duration-200", expandedCollections[c.name] && "rotate-180")} />
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="px-5 py-1.5 space-y-2 overflow-hidden animate-atlas-slide-in-top">
                        {c.fields && c.fields.length > 0 ? (
                          c.fields.slice(0, 15).map((f) => (
                            <div key={f.name} className="group/field">
                              <div className="flex items-center justify-between text-[11px]">
                                <span className="text-foreground/80 font-medium truncate flex items-center gap-1.5">
                                  {f.type === 'number' ? <Hash className="h-2.5 w-2.5 text-blue-400" /> : <Type className="h-2.5 w-2.5 text-primary/70" />}
                                  {f.name}
                                </span>
                                <span className="text-[9px] uppercase tracking-wider text-muted-foreground/40 font-bold bg-white/5 px-1 rounded">
                                  {f.type}
                                </span>
                              </div>
                              {f.sample && (
                                <div className="mt-0.5 flex items-start gap-1 p-1 rounded bg-white/[0.02] border border-white/[0.03] opacity-0 group-hover/field:opacity-100 transition-opacity duration-200">
                                  <Eye className="h-2.5 w-2.5 text-muted-foreground/30 mt-0.5 shrink-0" />
                                  <span className="text-[10px] text-muted-foreground/60 italic truncate leading-tight">
                                    {String(f.sample).length > 30 ? `${String(f.sample).substring(0, 30)}…` : String(f.sample)}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))
                        ) : (
                          <div className="text-[10px] text-muted-foreground/40 italic py-1 text-center">
                            No metadata available
                          </div>
                        )}
                        {c.fields?.length > 15 && (
                          <div className="text-[9px] text-muted-foreground/30 text-center pt-1 border-t border-white/5">
                            + {c.fields.length - 15} more fields
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                  
                  {/* Refresh Schema button at bottom of list */}
                  <button 
                    onClick={() => refreshSchema()}
                    className="w-full flex items-center justify-center gap-2 py-2 mt-2 text-[10px] text-muted-foreground/40 hover:text-primary transition-colors hover:bg-primary/5 rounded-lg border border-dashed border-white/5"
                  >
                    <RefreshCw className={cn("h-3 w-3", schemaLoading && "animate-spin")} />
                    Refresh Schema Metadata
                  </button>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>
      </div>
    </aside>
  );
}

