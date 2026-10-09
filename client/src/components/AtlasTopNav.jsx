import { useState } from "react";
import { Settings, Brain, Menu, LogOut, MessageSquare, LayoutDashboard } from "lucide-react";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";
import ScopeWorkspaceSelector from "./ScopeWorkspaceSelector";
import { useWorkspaces } from "../hooks/useWorkspaces";
import { useSchema } from "../hooks/useSchema";

/**
 * AtlasTopNav — Top navigation bar with ScopeWorkspaceSelector integration.
 */
export default function AtlasTopNav({ 
  onMenuToggle, 
  showMenu, 
  connectionMeta, 
  onLogout,
  activeView = 'chat',
  onViewChange,
  workspaces: propsWorkspaces,
  activeWorkspaceId: propsActiveWorkspaceId,
  onSelectWorkspace: propsOnSelectWorkspace,
  scopeMode: propsScopeMode,
  onChangeScopeMode: propsOnChangeScopeMode,
  selectedCollections: propsSelectedCollections,
  onSetCollections: propsOnSetCollections,
  onRemoveCollection: propsOnRemoveCollection,
  schema: propsSchema,
  onCreateWorkspace: propsOnCreateWorkspace,
  onUpdateWorkspace: propsOnUpdateWorkspace,
  onDeleteWorkspace: propsOnDeleteWorkspace,
}) {
  const dbLabel = connectionMeta?.dbName || connectionMeta?.label || 'Atlas Connected';

  // Fallback hooks if not passed from parent
  const workspacesHook = useWorkspaces();
  const schemaHook = useSchema();

  const workspaces = propsWorkspaces ?? workspacesHook.workspaces;
  const schema = propsSchema ?? schemaHook.schema;
  const onCreateWorkspace = propsOnCreateWorkspace ?? workspacesHook.createWorkspace;
  const onUpdateWorkspace = propsOnUpdateWorkspace ?? workspacesHook.updateWorkspace;
  const onDeleteWorkspace = propsOnDeleteWorkspace ?? workspacesHook.deleteWorkspace;

  // Local state fallbacks if not controlled by parent
  const [localActiveWorkspaceId, setLocalActiveWorkspaceId] = useState(null);
  const [localScopeMode, setLocalScopeMode] = useState('all');
  const [localSelectedCollections, setLocalSelectedCollections] = useState([]);

  const activeWorkspaceId = propsActiveWorkspaceId !== undefined ? propsActiveWorkspaceId : localActiveWorkspaceId;
  const scopeMode = propsScopeMode !== undefined ? propsScopeMode : localScopeMode;
  const selectedCollections = propsSelectedCollections !== undefined ? propsSelectedCollections : localSelectedCollections;

  const onSelectWorkspace = propsOnSelectWorkspace ?? ((id, cols) => {
    setLocalActiveWorkspaceId(id);
    if (id) {
      setLocalScopeMode('selected');
      setLocalSelectedCollections(cols || []);
    } else {
      setLocalScopeMode('all');
      setLocalSelectedCollections([]);
    }
  });

  const onChangeScopeMode = propsOnChangeScopeMode ?? setLocalScopeMode;
  const onSetCollections = propsOnSetCollections ?? setLocalSelectedCollections;
  const onRemoveCollection = propsOnRemoveCollection ?? ((col) => setLocalSelectedCollections((prev) => prev.filter((c) => c !== col)));

  return (
    <header className="min-h-14 border-b border-white/5 bg-background/80 backdrop-blur-xl flex flex-col justify-center px-6 z-50 shrink-0 shadow-[0_2px_20px_rgba(0,0,0,0.25)] transition-all">
      <div className="flex items-center justify-between w-full py-2">
      {/* Logo + Mobile menu toggle */}
      <div className="flex items-center gap-3">
        {showMenu && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuToggle}
            className="text-muted-foreground hover:text-foreground h-9 w-9"
            aria-label="Toggle sidebar menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        )}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shadow-[0_0_12px_rgba(0,237,100,0.35)]">
            <Brain className="h-4 w-4 text-background" fill="currentColor" />
          </div>
          <span className="text-lg font-display font-bold tracking-tight text-foreground select-none">
            Atlas<span className="text-primary">Mind</span>
          </span>
        </div>
      </div>

      {/* Center Segmented View Switcher & Workspace Scope Selector */}
      <div className="flex items-center gap-4">
        {onViewChange && (
          <div className="flex items-center p-0.5 bg-white/[0.04] border border-white/5 rounded-xl shrink-0">
            <button
              onClick={() => onViewChange('chat')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 ${
                activeView === 'chat'
                  ? "bg-white/[0.08] text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"
              }`}
            >
              <MessageSquare className={`h-3.5 w-3.5 transition-colors ${activeView === 'chat' ? "text-primary" : "text-muted-foreground"}`} />
              <span>Chat Panel</span>
            </button>
            <button
              onClick={() => onViewChange('dashboard')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold tracking-wide transition-all duration-200 ${
                activeView === 'dashboard'
                  ? "bg-white/[0.08] text-foreground shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.02]"
              }`}
            >
              <LayoutDashboard className={`h-3.5 w-3.5 transition-colors ${activeView === 'dashboard' ? "text-primary" : "text-muted-foreground"}`} />
              <span>Dashboard</span>
            </button>
          </div>
        )}

        {/* Scope Workspace Selector */}
        <div className="hidden md:block">
          <ScopeWorkspaceSelector
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            onSelectWorkspace={onSelectWorkspace}
            scopeMode={scopeMode}
            onChangeScopeMode={onChangeScopeMode}
            selectedCollections={selectedCollections}
            onSetCollections={onSetCollections}
            onRemoveCollection={onRemoveCollection}
            schema={schema}
            onCreateWorkspace={onCreateWorkspace}
            onUpdateWorkspace={onUpdateWorkspace}
            onDeleteWorkspace={onDeleteWorkspace}
          />
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* DB connection status */}
        <div className="flex items-center gap-2.5 bg-white/[0.04] border border-white/5 px-3 py-1.5 text-[11.5px] font-medium rounded-xl">
          <span className="relative flex h-2 w-2">
            <span className="animate-atlas-pulse-dot absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 shadow-[0_0_10px_rgba(0,237,100,0.7)]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-foreground/80 hidden md:inline font-mono tracking-tight truncate max-w-[140px]">
            {dbLabel}
          </span>
        </div>

        {/* Settings */}
        <Tooltip text="Settings" side="bottom">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground h-8 w-8" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>
        </Tooltip>

        {/* Disconnect */}
        {onLogout && (
          <Tooltip text="Disconnect" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              className="text-muted-foreground hover:text-destructive transition-colors h-8 w-8"
              aria-label="Disconnect database"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}

        {/* User avatar */}
        <Tooltip text="Account" side="bottom">
          <Avatar className="h-7 w-7 border border-white/10 ring-2 ring-background shadow-sm cursor-pointer">
            <AvatarFallback className="bg-white/10 text-[11px] text-foreground font-medium">AM</AvatarFallback>
          </Avatar>
        </Tooltip>
      </div>
    </div>

    {/* Scope Workspace Selector for smaller screens */}
    <div className="block md:hidden w-full pb-1">
      <ScopeWorkspaceSelector
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={onSelectWorkspace}
        scopeMode={scopeMode}
        onChangeScopeMode={onChangeScopeMode}
        selectedCollections={selectedCollections}
        onSetCollections={onSetCollections}
        onRemoveCollection={onRemoveCollection}
        schema={schema}
        onCreateWorkspace={onCreateWorkspace}
        onUpdateWorkspace={onUpdateWorkspace}
        onDeleteWorkspace={onDeleteWorkspace}
      />
    </div>
  </header>
  );
}
