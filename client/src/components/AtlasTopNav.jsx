import { Settings, Database, Menu, LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "./ui/avatar";
import { Button } from "./ui/button";
import { Tooltip } from "./ui/tooltip";

/**
 * AtlasTopNav — Top navigation bar.
 *
 * Props:
 *   onMenuToggle    — opens mobile sidebar
 *   showMenu        — whether to show the hamburger icon
 *   connectionMeta  — { dbName, label } from useAuth
 *   onLogout        — calls POST /api/auth/logout and redirects to landing page
 */
export default function AtlasTopNav({ onMenuToggle, showMenu, connectionMeta, onLogout }) {
  const dbLabel = connectionMeta?.dbName || connectionMeta?.label || 'Atlas Connected';

  return (
    <header className="h-20 border-b border-white/5 bg-background/80 backdrop-blur-xl flex items-center justify-between px-6 z-50 shrink-0 shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
      {/* Logo + Mobile menu toggle */}
      <div className="flex items-center gap-3">
        {showMenu && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuToggle}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Toggle sidebar menu"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-[0_0_15px_rgba(0,237,100,0.3)]">
            <Database className="h-4 w-4 text-background" />
          </div>
          <span className="text-xl font-display font-bold tracking-tight text-foreground">
            Atlas<span className="text-primary">Mind</span>
          </span>
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        {/* DB connection status — shows actual DB name */}
        <div className="flex items-center gap-3 atlas-glass px-4 py-2 text-[12px] font-medium rounded-2xl">
          <span className="relative flex h-2 w-2">
            <span className="animate-atlas-pulse-dot absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 shadow-[0_0_10px_rgba(0,237,100,0.7)]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="text-foreground/90 hidden sm:inline font-mono tracking-tight truncate max-w-[160px]">
            {dbLabel}
          </span>
        </div>

        {/* Settings */}
        <Tooltip text="Settings" side="bottom">
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground" aria-label="Settings">
            <Settings className="h-4 w-4" />
          </Button>
        </Tooltip>

        {/* Disconnect — calls logout and returns to landing page */}
        {onLogout && (
          <Tooltip text="Disconnect" side="bottom">
            <Button
              variant="ghost"
              size="icon"
              onClick={onLogout}
              className="text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Disconnect database"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}

        {/* User avatar */}
        <Tooltip text="Account" side="bottom">
          <Avatar className="h-8 w-8 border border-white/10 ring-2 ring-background shadow-sm cursor-pointer">
            <AvatarFallback className="bg-white/10 text-xs text-foreground font-medium">AM</AvatarFallback>
          </Avatar>
        </Tooltip>
      </div>
    </header>
  );
}
