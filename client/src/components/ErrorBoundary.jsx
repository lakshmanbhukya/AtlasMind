import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { TurnButton } from "./app/turnParts";

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
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-vg-red bg-[var(--vg-red-wash)] p-6 text-center animate-atlas-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-vg-red bg-vg-surface-2">
            <AlertTriangle className="h-5 w-5 text-vg-red" />
          </div>
          <p className="text-sm font-medium text-vg-text">
            {this.props.label
              ? `Unable to render ${this.props.label}`
              : "Something went wrong"}
          </p>
          <p className="max-w-[240px] text-xs leading-relaxed text-vg-text-2">
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <TurnButton onClick={this.handleReset} className="mt-1 h-8 text-xs">
            <RotateCcw className="h-3 w-3" />
            Try Again
          </TurnButton>
        </div>
      );
    }

    return this.props.children;
  }
}
