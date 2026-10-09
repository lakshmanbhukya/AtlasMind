import { useState, useMemo, useRef, useEffect } from 'react';
import {
    Layers,
    ChevronDown,
    Check,
    Settings,
    Plus,
    Database,
    Search,
    X,
    Trash2,
    Sparkles,
    AlertCircle,
    SlidersHorizontal,
} from 'lucide-react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ShimmerButton } from './ui/shimmer-button';
import { cn } from '../lib/utils';

/**
 * ScopeWorkspaceSelector
 *
 * Antigravity-style project/workspace picker for MongoDB collection scopes:
 * - Mode toggle: All (default) / Selected / Auto (Beta)
 * - Saved workspaces list with active checkmark, collection counts, and gear edit icon
 * - New workspace creator with searchable checklist of collections (name, doc count, sample fields)
 * - Chip row showing active collections in scope
 * - Responsive: dropdown on desktop, bottom sheet drawer on mobile
 */
export default function ScopeWorkspaceSelector({
    workspaces = [],
    activeWorkspaceId = null,
    onSelectWorkspace,
    scopeMode = 'all',
    onChangeScopeMode,
    selectedCollections = [],
    onSetCollections,
    onRemoveCollection,
    schema = null,
    onCreateWorkspace,
    onUpdateWorkspace,
    onDeleteWorkspace,
}) {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editingWorkspace, setEditingWorkspace] = useState(null); // null = new, object = edit

    // Editor form state
    const [editorName, setEditorName] = useState('');
    const [editorSelectedCols, setEditorSelectedCols] = useState([]);
    const [editorSearch, setEditorSearch] = useState('');
    const [editorError, setEditorError] = useState(null);
    const [isSaving, setIsSaving] = useState(false);

    // Dropdown collection search & chip add popover state
    const [colSearch, setColSearch] = useState('');
    const [addColMenuOpen, setAddColMenuOpen] = useState(false);

    const dropdownRef = useRef(null);
    const addColMenuRef = useRef(null);

    // Available collections from schema
    const availableCollections = useMemo(() => {
        if (!schema || !Array.isArray(schema.collections)) return [];
        return schema.collections;
    }, [schema]);

    // Active workspace details if any
    const activeWorkspace = useMemo(() => {
        if (!activeWorkspaceId) return null;
        return workspaces.find((w) => w.id === activeWorkspaceId || w._id === activeWorkspaceId) || null;
    }, [workspaces, activeWorkspaceId]);

    // Close dropdown & addColMenu on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setDropdownOpen(false);
            }
            if (addColMenuRef.current && !addColMenuRef.current.contains(e.target)) {
                setAddColMenuOpen(false);
            }
        };
        if (dropdownOpen || addColMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [dropdownOpen, addColMenuOpen]);

    // Open editor for creating new workspace
    const handleOpenNewEditor = () => {
        setEditingWorkspace(null);
        setEditorName('');
        setEditorSelectedCols(selectedCollections.length > 0 ? [...selectedCollections] : []);
        setEditorSearch('');
        setEditorError(null);
        setDropdownOpen(false);
        setEditorOpen(true);
    };

    // Open editor for modifying an existing workspace
    const handleOpenEditWorkspace = (ws, e) => {
        e.stopPropagation();
        setEditingWorkspace(ws);
        setEditorName(ws.name);
        setEditorSelectedCols([...(ws.collections || [])]);
        setEditorSearch('');
        setEditorError(null);
        setDropdownOpen(false);
        setEditorOpen(true);
    };

    // Save editor form
    const handleSaveWorkspace = async () => {
        if (!editorName.trim()) {
            setEditorError('Workspace name is required');
            return;
        }
        if (editorSelectedCols.length === 0) {
            setEditorError('Select at least one collection');
            return;
        }

        setIsSaving(true);
        setEditorError(null);
        try {
            if (editingWorkspace) {
                await onUpdateWorkspace(editingWorkspace.id || editingWorkspace._id, {
                    name: editorName.trim(),
                    collections: editorSelectedCols,
                });
            } else {
                const created = await onCreateWorkspace({
                    name: editorName.trim(),
                    collections: editorSelectedCols,
                });
                if (created && (created.id || created._id)) {
                    onSelectWorkspace(created.id || created._id, editorSelectedCols);
                }
            }
            setEditorOpen(false);
        } catch (err) {
            setEditorError(err.response?.data?.error?.message || err.message || 'Failed to save workspace');
        } finally {
            setIsSaving(false);
        }
    };

    // Filter collections in editor search
    const filteredEditorCollections = useMemo(() => {
        if (!editorSearch.trim()) return availableCollections;
        const s = editorSearch.toLowerCase();
        return availableCollections.filter((c) => {
            if (c.name.toLowerCase().includes(s)) return true;
            return (c.fields || []).some((f) => f.name.toLowerCase().includes(s));
        });
    }, [availableCollections, editorSearch]);

    // Active chip labels
    const chipCollections = useMemo(() => {
        if (scopeMode === 'all') {
            return [];
        }
        return selectedCollections;
    }, [scopeMode, selectedCollections]);

    // Toggle a collection into/out of selected collections
    const handleToggleCollection = (colName) => {
        const isSelected = selectedCollections.includes(colName);
        const next = isSelected
            ? selectedCollections.filter((c) => c !== colName)
            : [...selectedCollections, colName];
        onSetCollections(next);
        if (scopeMode !== 'selected') {
            onChangeScopeMode('selected');
        }
    };

    // Filter collections in the main dropdown search
    const filteredDropdownCollections = useMemo(() => {
        if (!colSearch.trim()) return availableCollections;
        const s = colSearch.toLowerCase();
        return availableCollections.filter((c) => {
            if (c.name.toLowerCase().includes(s)) return true;
            return (c.fields || []).some((f) => f.name.toLowerCase().includes(s));
        });
    }, [availableCollections, colSearch]);

    // Collections currently available in DB but not selected
    const unselectedCollections = useMemo(() => {
        const selectedSet = new Set(selectedCollections);
        return availableCollections.filter((c) => !selectedSet.has(c.name));
    }, [availableCollections, selectedCollections]);

    return (
        <div className="w-full max-w-4xl mx-auto mb-2 px-2" ref={dropdownRef}>
            {/* Top row: Scope Dropdown trigger & Active Mode Selector */}
            <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2">
                {/* Antigravity-style Workspace Dropdown Trigger */}
                <div className="relative">
                    <button
                        type="button"
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-xs font-semibold text-foreground/90 transition-all duration-200 select-none group focus:outline-none focus:ring-1 focus:ring-primary/40 shadow-sm"
                    >
                        <Layers className="h-3.5 w-3.5 text-primary" />
                        <span className="max-w-[180px] truncate">
                            {scopeMode === 'all'
                                ? 'All collections'
                                : activeWorkspace
                                ? activeWorkspace.name
                                : `Custom scope (${selectedCollections.length})`}
                        </span>
                        {scopeMode === 'selected' && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary bg-primary/10">
                                {selectedCollections.length}
                            </Badge>
                        )}
                        <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-200', dropdownOpen && 'rotate-180')} />
                    </button>

                    {/* Desktop Dropdown & Mobile Bottom Sheet */}
                    {dropdownOpen && (
                        <>
                            {/* Backdrop */}
                            <div
                                className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:bg-transparent md:backdrop-blur-none"
                                onClick={() => setDropdownOpen(false)}
                            />

                            {/* Menu Container (Dropdown on desktop, bottom sheet on mobile) */}
                            <div className="fixed inset-x-0 bottom-0 md:absolute md:inset-auto md:bottom-auto md:top-full md:left-0 md:mt-2 w-full md:w-[360px] bg-[#0c111a] border-t md:border border-white/15 rounded-t-3xl md:rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.85)] z-50 overflow-hidden animate-atlas-slide-in-bottom">
                                {/* Mobile Handle */}
                                <div className="md:hidden flex justify-center pt-3 pb-1">
                                    <div className="w-10 h-1 bg-white/20 rounded-full" />
                                </div>

                                {/* Menu Header: Mode Switcher */}
                                <div className="p-3 border-b border-white/10 bg-white/[0.02]">
                                    <div className="flex items-center justify-between mb-2 px-1">
                                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                                            Scope Mode
                                        </span>
                                        <span className="text-[10px] text-primary/70 font-mono">
                                            {availableCollections.length} DB Collections
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1 bg-black/40 p-1 rounded-xl border border-white/5">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onChangeScopeMode('all');
                                                onSelectWorkspace(null, []);
                                                setDropdownOpen(false);
                                            }}
                                            className={cn(
                                                'px-2 py-1.5 rounded-lg text-xs font-semibold transition-all text-center cursor-pointer',
                                                scopeMode === 'all'
                                                    ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                            )}
                                        >
                                            All
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onChangeScopeMode('selected');
                                                if (selectedCollections.length === 0 && availableCollections.length > 0) {
                                                    onSetCollections(availableCollections.map((c) => c.name));
                                                }
                                            }}
                                            className={cn(
                                                'px-2 py-1.5 rounded-lg text-xs font-semibold transition-all text-center cursor-pointer',
                                                scopeMode === 'selected'
                                                    ? 'bg-primary/20 text-primary border border-primary/30 shadow-sm'
                                                    : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
                                            )}
                                        >
                                            Selected
                                        </button>
                                        <button
                                            type="button"
                                            disabled
                                            title="Auto-scoping (Beta)"
                                            className="px-2 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground/40 text-center cursor-not-allowed flex items-center justify-center gap-1 opacity-60"
                                        >
                                            <Sparkles className="h-3 w-3" />
                                            <span>Auto</span>
                                        </button>
                                    </div>
                                </div>

                                {/* Content Area: Collections & Workspaces */}
                                <div className="p-2 max-h-[380px] overflow-y-auto space-y-2">
                                    {/* All Collections Entry */}
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onChangeScopeMode('all');
                                            onSelectWorkspace(null, []);
                                            setDropdownOpen(false);
                                        }}
                                        className={cn(
                                            'w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-medium transition-colors text-left cursor-pointer',
                                            scopeMode === 'all'
                                                ? 'bg-primary/10 text-primary border border-primary/20'
                                                : 'text-foreground/80 hover:bg-white/5 hover:text-foreground'
                                        )}
                                    >
                                        <div className="flex items-center gap-2.5">
                                            <Database className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                                            <div>
                                                <span>All collections</span>
                                                <span className="text-[10px] text-muted-foreground/50 block font-normal">
                                                    Full database scope ({availableCollections.length} collections)
                                                </span>
                                            </div>
                                        </div>
                                        {scopeMode === 'all' && <Check className="h-3.5 w-3.5 text-primary" />}
                                    </button>

                                    {/* Database Collections Checklist for Custom Scope */}
                                    <div className="pt-2 border-t border-white/10">
                                        <div className="flex items-center justify-between px-1 mb-1.5">
                                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                                Collections ({scopeMode === 'all' ? availableCollections.length : selectedCollections.length}/{availableCollections.length})
                                            </span>
                                            <div className="flex items-center gap-2 text-[11px]">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onSetCollections(availableCollections.map((c) => c.name));
                                                        if (scopeMode !== 'selected') onChangeScopeMode('selected');
                                                    }}
                                                    className="text-primary hover:underline font-medium cursor-pointer"
                                                >
                                                    Select All
                                                </button>
                                                <span className="text-white/20">·</span>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        onSetCollections([]);
                                                        if (scopeMode !== 'selected') onChangeScopeMode('selected');
                                                    }}
                                                    className="text-muted-foreground hover:text-foreground font-medium cursor-pointer"
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        {/* Filter search if > 4 collections */}
                                        {availableCollections.length > 4 && (
                                            <div className="relative mb-2 px-0.5">
                                                <Search className="h-3 w-3 text-muted-foreground/50 absolute left-2.5 top-1/2 -translate-y-1/2" />
                                                <input
                                                    type="text"
                                                    value={colSearch}
                                                    onChange={(e) => setColSearch(e.target.value)}
                                                    placeholder="Filter collections…"
                                                    className="w-full bg-white/[0.04] border border-white/10 rounded-lg pl-7 pr-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 transition-all"
                                                />
                                            </div>
                                        )}

                                        {/* Individual Collection Checkbox Items */}
                                        <div className="space-y-1 max-h-[170px] overflow-y-auto pr-0.5">
                                            {filteredDropdownCollections.length === 0 ? (
                                                <p className="text-[11px] text-muted-foreground/40 py-2 text-center italic">No matching collections</p>
                                            ) : (
                                                filteredDropdownCollections.map((col) => {
                                                    const isChecked = scopeMode === 'selected' 
                                                        ? selectedCollections.includes(col.name)
                                                        : true;
                                                    return (
                                                        <button
                                                            key={col.name}
                                                            type="button"
                                                            onClick={() => handleToggleCollection(col.name)}
                                                            className={cn(
                                                                'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors text-left group cursor-pointer',
                                                                isChecked && scopeMode === 'selected'
                                                                    ? 'bg-primary/10 text-primary border border-primary/20'
                                                                    : 'text-foreground/80 hover:bg-white/5 hover:text-foreground border border-transparent'
                                                            )}
                                                        >
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <span
                                                                    className={cn(
                                                                        'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                                        isChecked
                                                                            ? 'bg-primary border-primary text-black'
                                                                            : 'border-white/30 group-hover:border-white/50'
                                                                    )}
                                                                >
                                                                    {isChecked && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                                                </span>
                                                                <span className="truncate">{col.name}</span>
                                                            </div>
                                                            {col.documentCount !== undefined && (
                                                                <span className="text-[10px] text-muted-foreground/50 font-mono ml-2 shrink-0">
                                                                    {col.documentCount.toLocaleString()} docs
                                                                </span>
                                                            )}
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>

                                    {/* Saved Workspaces Section */}
                                    {workspaces.length > 0 && (
                                        <div className="pt-2 border-t border-white/10">
                                            <div className="px-1 mb-1.5 flex items-center justify-between">
                                                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                                                    Saved Workspaces
                                                </span>
                                                <span className="text-[10px] text-muted-foreground/40 font-mono">
                                                    {workspaces.length} preset{workspaces.length > 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className="space-y-1 max-h-[140px] overflow-y-auto pr-0.5">
                                                {workspaces.map((ws) => {
                                                    const isCurrent = scopeMode === 'selected' && activeWorkspaceId === ws.id;
                                                    const hasMissing = ws.hasMissingCollections;
                                                    return (
                                                        <div
                                                            key={ws.id}
                                                            className={cn(
                                                                'group/item flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors border mb-1',
                                                                isCurrent
                                                                    ? 'bg-primary/10 border-primary/30 text-primary'
                                                                    : 'border-transparent text-foreground/85 hover:bg-white/5 hover:border-white/5'
                                                            )}
                                                        >
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    onChangeScopeMode('selected');
                                                                    onSelectWorkspace(ws.id, ws.availableCollections || ws.collections);
                                                                    setDropdownOpen(false);
                                                                }}
                                                                className="flex-1 flex items-center gap-2 text-left min-w-0 cursor-pointer"
                                                            >
                                                                <Layers className={cn('h-3.5 w-3.5 shrink-0', isCurrent ? 'text-primary' : 'text-muted-foreground/60')} />
                                                                <div className="min-w-0 flex-1">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="truncate">{ws.name}</span>
                                                                        {hasMissing && (
                                                                            <span
                                                                                title={`${ws.missingCollections.length} collection(s) missing from DB`}
                                                                                className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-mono"
                                                                            >
                                                                                !
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <span className="text-[10px] text-muted-foreground/50 block truncate">
                                                                        {(ws.availableCollections || ws.collections).join(' · ')}
                                                                    </span>
                                                                </div>
                                                                {isCurrent && <Check className="h-3.5 w-3.5 text-primary ml-1 shrink-0" />}
                                                            </button>

                                                            {/* Edit Workspace Gear Button */}
                                                            <button
                                                                type="button"
                                                                onClick={(e) => handleOpenEditWorkspace(ws, e)}
                                                                title="Edit workspace"
                                                                className="p-1 rounded-lg text-muted-foreground/50 hover:text-foreground hover:bg-white/10 ml-1 transition-colors shrink-0 cursor-pointer"
                                                            >
                                                                <Settings className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Menu Footer: New Workspace Button */}
                                <div className="p-2 border-t border-white/10 bg-white/[0.02]">
                                    <button
                                        type="button"
                                        onClick={handleOpenNewEditor}
                                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-primary hover:bg-primary/10 border border-primary/20 hover:border-primary/40 transition-all duration-200 cursor-pointer"
                                    >
                                        <Plus className="h-3.5 w-3.5" />
                                        <span>New workspace</span>
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                {/* Scope Mentions Hint */}
                <div className="text-[11px] text-muted-foreground/40 hidden sm:flex items-center gap-1">
                    <span>Tip: type <code className="text-[10px] text-primary/70 font-mono bg-white/5 px-1 py-0.5 rounded">@collection</code> in query to add temporarily</span>
                </div>
            </div>

            {/* Scope Active Chips Row (always visible when selected or custom) */}
            {scopeMode === 'selected' && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1 animate-atlas-fade-in">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 mr-1 flex items-center gap-1">
                        <SlidersHorizontal className="h-3 w-3" />
                        Scope:
                    </span>
                    {chipCollections.length === 0 ? (
                        <button
                            type="button"
                            onClick={() => setDropdownOpen(true)}
                            className="text-xs text-amber-400/90 hover:underline flex items-center gap-1 bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20 cursor-pointer"
                        >
                            <span>No collections selected</span>
                            <span className="text-[10px] font-semibold text-primary underline ml-1">+ Select collections</span>
                        </button>
                    ) : (
                        chipCollections.map((colName) => (
                            <span
                                key={colName}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/30 text-primary text-[11px] font-medium shadow-sm transition-all"
                            >
                                <Database className="h-2.5 w-2.5 opacity-70" />
                                <span>{colName}</span>
                                {onRemoveCollection && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveCollection(colName)}
                                        title={`Remove ${colName} from scope`}
                                        className="hover:text-destructive transition-colors ml-0.5 cursor-pointer"
                                    >
                                        <X className="h-2.5 w-2.5" />
                                    </button>
                                )}
                            </span>
                        ))
                    )}

                    {/* + Add collection button to add unselected collections directly from chips */}
                    {unselectedCollections.length > 0 && (
                        <div className="relative" ref={addColMenuRef}>
                            <button
                                type="button"
                                onClick={() => setAddColMenuOpen(!addColMenuOpen)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-muted-foreground hover:text-primary text-[11px] font-medium transition-all cursor-pointer"
                                title="Add collection to scope"
                            >
                                <Plus className="h-3 w-3 text-primary" />
                                <span>Add</span>
                                <ChevronDown className={cn("h-3 w-3 text-muted-foreground/60 transition-transform", addColMenuOpen && "rotate-180")} />
                            </button>

                            {addColMenuOpen && (
                                <div className="absolute left-0 top-full mt-1.5 w-48 bg-[#0c111a] border border-white/15 rounded-xl shadow-[0_15px_35px_rgba(0,0,0,0.85)] z-50 p-1 space-y-0.5 animate-atlas-fade-in max-h-48 overflow-y-auto">
                                    <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60 border-b border-white/5 mb-1">
                                        Add to Scope
                                    </div>
                                    {unselectedCollections.map((col) => (
                                        <button
                                            key={col.name}
                                            type="button"
                                            onClick={() => {
                                                handleToggleCollection(col.name);
                                                if (unselectedCollections.length <= 1) {
                                                    setAddColMenuOpen(false);
                                                }
                                            }}
                                            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs text-foreground/80 hover:bg-white/5 hover:text-foreground text-left cursor-pointer"
                                        >
                                            <span className="truncate">{col.name}</span>
                                            <Plus className="h-3 w-3 text-primary/70 shrink-0" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="button"
                        onClick={handleOpenNewEditor}
                        className="text-[11px] text-muted-foreground hover:text-primary transition-colors underline ml-2 cursor-pointer"
                    >
                        Save as workspace
                    </button>
                </div>
            )}

            {/* Workspace Editor Modal */}
            {editorOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-atlas-fade-in">
                    <div className="w-full max-w-lg bg-[#0e141f] border border-white/15 rounded-3xl p-6 shadow-[0_25px_60px_rgba(0,0,0,0.9)] flex flex-col max-h-[85vh]">
                        {/* Header */}
                        <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
                            <div>
                                <h3 className="text-base font-bold text-foreground">
                                    {editingWorkspace ? `Edit Workspace` : 'Create Workspace'}
                                </h3>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Select the collections this workspace should include.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setEditorOpen(false)}
                                className="p-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-white/10"
                            >
                                <X className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Error Alert */}
                        {editorError && (
                            <div className="mb-4 p-3 rounded-xl bg-destructive/15 border border-destructive/30 text-destructive text-xs flex items-center gap-2">
                                <AlertCircle className="h-4 w-4 shrink-0" />
                                <span>{editorError}</span>
                            </div>
                        )}

                        {/* Name Input */}
                        <div className="mb-4">
                            <label className="block text-xs font-semibold text-muted-foreground/80 mb-1.5 uppercase tracking-wider">
                                Workspace Name
                            </label>
                            <input
                                type="text"
                                value={editorName}
                                onChange={(e) => setEditorName(e.target.value)}
                                placeholder="e.g. Sales & Customers"
                                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/30 transition-all"
                            />
                        </div>

                        {/* Collections Checklist Header & Search */}
                        <div className="mb-2">
                            <div className="flex items-center justify-between mb-2">
                                <label className="text-xs font-semibold text-muted-foreground/80 uppercase tracking-wider">
                                    Collections ({editorSelectedCols.length} selected)
                                </label>
                                <div className="flex items-center gap-2 text-[11px]">
                                    <button
                                        type="button"
                                        onClick={() => setEditorSelectedCols(availableCollections.map((c) => c.name))}
                                        className="text-primary hover:underline"
                                    >
                                        Select All
                                    </button>
                                    <span className="text-white/20">·</span>
                                    <button
                                        type="button"
                                        onClick={() => setEditorSelectedCols([])}
                                        className="text-muted-foreground hover:text-foreground"
                                    >
                                        Clear
                                    </button>
                                </div>
                            </div>
                            <div className="relative">
                                <Search className="h-3.5 w-3.5 text-muted-foreground/50 absolute left-3 top-1/2 -translate-y-1/2" />
                                <input
                                    type="text"
                                    value={editorSearch}
                                    onChange={(e) => setEditorSearch(e.target.value)}
                                    placeholder="Search collections or fields…"
                                    className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/40 transition-all"
                                />
                            </div>
                        </div>

                        {/* Searchable Collections List */}
                        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 max-h-[260px] my-2">
                            {filteredEditorCollections.length === 0 ? (
                                <p className="text-xs text-muted-foreground/50 py-4 text-center">No collections found</p>
                            ) : (
                                filteredEditorCollections.map((col) => {
                                    const isChecked = editorSelectedCols.includes(col.name);
                                    const sampleFields = (col.fields || []).slice(0, 3).map((f) => f.name).join(', ');
                                    return (
                                        <button
                                            key={col.name}
                                            type="button"
                                            onClick={() => {
                                                setEditorSelectedCols((prev) =>
                                                    prev.includes(col.name)
                                                        ? prev.filter((c) => c !== col.name)
                                                        : [...prev, col.name]
                                                );
                                            }}
                                            className={cn(
                                                'w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-all',
                                                isChecked
                                                    ? 'bg-primary/10 border-primary/30 text-foreground'
                                                    : 'bg-white/[0.02] border-white/5 text-muted-foreground hover:bg-white/[0.04]'
                                            )}
                                        >
                                            <span
                                                className={cn(
                                                    'w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors',
                                                    isChecked ? 'bg-primary border-primary text-black' : 'border-white/20'
                                                )}
                                            >
                                                {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center justify-between">
                                                    <span className="text-xs font-semibold text-foreground truncate">{col.name}</span>
                                                    <span className="text-[10px] text-muted-foreground/60 font-mono">
                                                        {col.documentCount?.toLocaleString() || 0} docs
                                                    </span>
                                                </div>
                                                {sampleFields && (
                                                    <p className="text-[10px] text-muted-foreground/45 truncate mt-0.5">
                                                        {sampleFields}
                                                    </p>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="flex items-center justify-between pt-4 border-t border-white/10 mt-auto">
                            {editingWorkspace && onDeleteWorkspace ? (
                                <button
                                    type="button"
                                    onClick={async () => {
                                        if (confirm(`Delete workspace "${editingWorkspace.name}"?`)) {
                                            await onDeleteWorkspace(editingWorkspace.id || editingWorkspace._id);
                                            setEditorOpen(false);
                                        }
                                    }}
                                    className="text-xs text-destructive hover:text-destructive/80 flex items-center gap-1.5 p-2 rounded-xl hover:bg-destructive/10 transition-colors"
                                >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    <span>Delete</span>
                                </button>
                            ) : (
                                <div />
                            )}

                            <div className="flex items-center gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditorOpen(false)}
                                    className="text-xs text-muted-foreground hover:text-foreground"
                                >
                                    Cancel
                                </Button>
                                <ShimmerButton
                                    onClick={handleSaveWorkspace}
                                    disabled={isSaving}
                                    shimmerColor="#00ed64"
                                    background="#042f1a"
                                    borderRadius="12px"
                                    className="px-5 py-2 text-xs font-bold h-9"
                                >
                                    {isSaving ? 'Saving…' : 'Save Workspace'}
                                </ShimmerButton>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
