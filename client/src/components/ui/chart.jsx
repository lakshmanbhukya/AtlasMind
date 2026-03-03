import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import { cn } from "../../lib/utils";

/**
 * ChartContainer — wraps Recharts charts with responsive container.
 * Injects CSS custom property color vars into the chart root.
 */
const ChartContainer = React.forwardRef(({ config = {}, className, children, ...props }, ref) => {
  // Build CSS vars from config (e.g. config.revenue.color → --color-revenue)
  const cssVars = Object.entries(config).reduce((acc, [key, value]) => {
    if (value.color) {
      acc[`--color-${key}`] = value.color;
    }
    return acc;
  }, {});

  return (
    <div
      ref={ref}
      className={cn("w-full", className)}
      style={cssVars}
      {...props}
    >
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
});
ChartContainer.displayName = "ChartContainer";

/**
 * ChartTooltip — thin wrapper around Recharts Tooltip.
 */
const ChartTooltip = Tooltip;

/**
 * ChartTooltipContent — custom tooltip content component for Recharts.
 */
const ChartTooltipContent = React.forwardRef(
  ({ active, payload, label, className, hideLabel = false }, ref) => {
    if (!active || !payload || !payload.length) return null;

    return (
      <div
        ref={ref}
        className={cn(
          "atlas-glass rounded-lg px-3 py-2 text-xs shadow-md min-w-[8rem]",
          className
        )}
      >
        {!hideLabel && label && (
          <p className="font-medium text-foreground mb-1">{label}</p>
        )}
        <div className="space-y-0.5">
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: entry.color || entry.fill }}
              />
              <span className="text-muted-foreground capitalize">{entry.name}</span>
              <span className="ml-auto font-mono font-semibold text-foreground">
                {typeof entry.value === "number" && entry.value >= 1000
                  ? `${(entry.value / 1000).toFixed(1)}K`
                  : entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
);
ChartTooltipContent.displayName = "ChartTooltipContent";

export { ChartContainer, ChartTooltip, ChartTooltipContent };
