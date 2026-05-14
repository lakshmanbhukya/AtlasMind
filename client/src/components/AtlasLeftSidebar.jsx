import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, MessageSquare, LayoutDashboard, ChevronDown, Database, Loader2, AlertCircle, Search, X, RefreshCw, Hash, Type, Eye, MoreVertical, Pencil, Trash2, Check, PinOff } from "lucide-react";
import { Button } from "./ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";
import { fetchQueryHistory, fetchDashboard, deleteQueryHistoryItem, renameQueryHistoryItem } from "../services/api";
import { useSchema } from "../hooks/useSchema";

/**
 * ItemMenu — Generic ⋮ dots menu for both history and pins.
 */
function ItemMenu({ 
  onRename, 
  onDelete, 
  deleteLabel = "Delete", 
  deleteIcon: DeleteIcon = Trash2,
  showRename = true 
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={menuRef} className="absolute right-2 top-1/2 -translate-y-1/2 z-20" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((p) => !p)}
        className="opacity-0 group-hover/item:opacity-100 focus:opacity-100 p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/10 transition-all duration-150 outline-none"
        title="More options"
        aria-label="More options"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-popover/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.5)] overflow-hidden z-50 animate-atlas-scale-in">
          {showRename && (
            <>
              <button
                onClick={() => { onRename(); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-foreground/80 hover:bg-white/5 hover:text-foreground transition-colors outline-none"
              >
                <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                Rename
              </button>
              <div className="h-px bg-white/5" />
            </>
          )}
          <button
            onClick={() => { onDelete(); setOpen(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-[12.5px] text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors outline-none"
          >
            <DeleteIcon className="h-3.5 w-3.5" />
            {deleteLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * HistoryItemRow — Manages single history item display and full-width inline editing.
 */
function HistoryItemRow({ item, onRename, onDelete, activeView, onViewChange, onSelectQueryId, highlightedMessageId }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName]   = useState(item.query);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isEditing) {
      setEditName(item.query);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isEditing, item.query]);

  const handleSave = async (e) => {
    e?.stopPropagation();
    const trimmed = editName.trim();
    if (trimmed && trimmed !== item.query) {
      await onRename(item.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <div 
        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 bg-white/[0.04] border border-primary/30 my-0.5"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-white/[0.02] border border-white/5 rounded-md px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/30 outline-none focus:border-primary/20 focus:bg-white/[0.04]"
        />
        <button 
          onClick={handleSave} 
          className="p-1 rounded text-primary hover:bg-primary/10 transition-colors outline-none"
          title="Save Name"
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); setIsEditing(false); }} 
          className="p-1 rounded text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors outline-none"
          title="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  const isHighlighted = activeView === 'chat' && 
    (highlightedMessageId ? item.id === highlightedMessageId : item.active);

  return (
    <div
      className={cn(
        "w-full flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition-all duration-200 hover:bg-sidebar-accent group/item relative cursor-pointer",
        isHighlighted && "bg-sidebar-accent border-l-2 border-primary/60"
      )}
      onClick={() => {
        onViewChange('chat');
        if (onSelectQueryId && item.id) {
          onSelectQueryId(item.id);
        }
      }}
    >
      <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 pr-10">
        <p className="truncate text-sidebar-foreground text-[13px]">{item.query}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{item.time}</p>
      </div>
      <ItemMenu
        onEditStart={() => setIsEditing(true)}
        onDelete={() => onDelete(item.id)}
        onRename={() => setIsEditing(true)}
      />
    </div>
  );
}

/**
 * PinnedItemRow — Manages single pinned item display.
 */
function PinnedItemRow({ pin, onRemove, activeView, onViewChange }) {
  const id = pin._id || pin.id;
  const isActive = activeView === 'dashboard';

  return (
    <div
      className={cn(
        "w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-all duration-200 hover:bg-sidebar-accent group/item relative cursor-pointer",
        isActive && "bg-primary/10 border-l-2 border-primary"
      )}
      onClick={() => onViewChange('dashboard')}
    >
      <LayoutDashboard className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1 pr-10">
        <p className={cn("truncate text-[13px]", isActive ? "text-primary font-medium" : "text-sidebar-foreground")}>
          {pin.name || pin.query}
        </p>
      </div>
      <ItemMenu
        onDelete={() => onRemove(id)}
        deleteLabel="Remove Pin"
        deleteIcon={PinOff}
        showRename={false}
      />
    </div>
  );
}

export default function AtlasLeftSidebar({ 
  onNewQuery, 
  activeView, 
  onViewChange, 
  pins = [], 
  onRemovePin,
  onSelectQueryId,
  highlightedMessageId,
  history = [],
  historyLoading = false,
  setHistory
}) {
  const [recentOpen,   setRecentOpen]   = useState(true);
  const [dashOpen,     setDashOpen]     = useState(true);
  const [collOpen,     setCollOpen]     = useState(true); 
  const [searchQuery,  setSearchQuery]  = useState("");

  const { 
    schema, 
    isLoading: schemaLoading, 
    error: schemaError,
    expandedCollections,
    toggleCollection,
    refreshSchema
  } = useSchema();

  const handleDeleteHistory = useCallback(async (id) => {
    try {
      await deleteQueryHistoryItem(id);
      if (setHistory) {
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (err) {
      console.error("❌ Failed to delete query history log:", err);
    }
  }, [setHistory]);

  const handleRenameHistory = useCallback(async (id, name) => {
    try {
      await renameQueryHistoryItem(id, name);
      if (setHistory) {
        setHistory((prev) => prev.map((item) => item.id === id ? { ...item, query: name } : item));
      }
    } catch (err) {
      console.error("❌ Failed to rename query history log:", err);
    }
  }, [setHistory]);

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
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 hover:text-primary transition-colors">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5" />
                Recent Chats
                {history.length > 0 && (
                  <span className="text-[10px] text-primary/60 font-mono">
                    [{filteredHistory.length}]
                  </span>
                )}
              </div>
              <ChevronDown
                className={cn("h-4 w-4 transition-transform duration-200", recentOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 mt-1">
              {historyLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : filteredHistory.length === 0 ? (
                <p className="px-3 py-2 text-[12px] text-muted-foreground/60">
                  {searchQuery ? "No matching queries" : "No queries yet"}
                </p>
              ) : (
                <div className="space-y-0.5">
                  {filteredHistory.map((item) => (
                    <HistoryItemRow
                      key={item.id}
                      item={item}
                      onRename={handleRenameHistory}
                      onDelete={handleDeleteHistory}
                      activeView={activeView}
                      onViewChange={onViewChange}
                      onSelectQueryId={onSelectQueryId}
                      highlightedMessageId={highlightedMessageId}
                    />
                  ))}
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Pinned Dashboards */}
        <div className="mt-4 pt-3.5 border-t border-white/[0.04]">
          <Collapsible open={dashOpen} onOpenChange={setDashOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 hover:text-primary transition-colors">
              <div className="flex items-center gap-1.5">
                <LayoutDashboard className="h-3.5 w-3.5" />
                Pinned Dashboards
              </div>
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform duration-200", dashOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-0.5 mt-1">
              {pins.length === 0 ? (
                <p className="px-3 py-1.5 text-[12px] text-muted-foreground/60">No pinned dashboards</p>
              ) : (
                pins.map((d) => (
                  <PinnedItemRow
                    key={d._id || d.id}
                    pin={d}
                    onRemove={onRemovePin}
                    activeView={activeView}
                    onViewChange={onViewChange}
                  />
                ))
              )}
            </CollapsibleContent>
          </Collapsible>
        </div>

        {/* Collections — live from GET /api/schema */}
        <div className="mt-4 pt-3.5 border-t border-white/[0.04]">
          <Collapsible open={collOpen} onOpenChange={setCollOpen}>
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/50 hover:text-primary transition-colors">
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
