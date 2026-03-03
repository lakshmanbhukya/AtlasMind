import * as React from "react";
import { cn } from "../../lib/utils";

/**
 * Tooltip — A simple, accessible tooltip using CSS-only approach.
 * Wraps children and shows tooltip text on hover/focus.
 *
 * Usage:
 *   <Tooltip text="Export results as JSON">
 *     <Button>...</Button>
 *   </Tooltip>
 */
const Tooltip = React.forwardRef(({ children, text, className, side = "bottom", ...props }, ref) => {
  if (!text) return children;

  const sideClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <div ref={ref} className={cn("relative group inline-flex", className)} {...props}>
      {children}
      <span
        className={cn(
          "absolute z-[100] pointer-events-none whitespace-nowrap",
          "rounded-lg bg-popover border border-white/10 px-2.5 py-1.5",
          "text-[11px] font-medium text-popover-foreground",
          "opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100",
          "transition-all duration-200 ease-out shadow-lg backdrop-blur-md",
          sideClasses[side] || sideClasses.bottom
        )}
        role="tooltip"
      >
        {text}
      </span>
    </div>
  );
});

Tooltip.displayName = "Tooltip";

export { Tooltip };
