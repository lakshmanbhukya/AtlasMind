import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "./ui/button";

/**
 * ErrorBoundary — Catches rendering errors in child components
 * and displays a graceful fallback instead of white-screening.
 *
 * Usage:
 *   <ErrorBoundary label="Chart">
 *     <ChartRenderer ... />
 *   </ErrorBoundary>
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error(`[ErrorBoundary:${this.props.label || "Unknown"}]`, error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-6 text-center backdrop-blur-md animate-atlas-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 border border-destructive/20">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground/90">
            {this.props.label
              ? `Unable to render ${this.props.label}`
              : "Something went wrong"}
          </p>
          <p className="text-xs text-muted-foreground max-w-[240px] leading-relaxed">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={this.handleReset}
            className="mt-1 gap-1.5 text-xs border-destructive/30 hover:bg-destructive/10"
          >
            <RotateCcw className="h-3 w-3" />
            Try Again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
