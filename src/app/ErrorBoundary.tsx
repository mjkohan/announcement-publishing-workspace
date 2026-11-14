import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "../ui";

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Defaults to reloading the page. */
  onReload?: () => void;
}

interface ErrorBoundaryState {
  failed: boolean;
}

const reloadPage = () => {
  window.location.reload();
};

/**
 * Top-level boundary: a render error shows a plain message instead of a blank page.
 * Reloading is safe: the journal restores every attempt and never publishes again.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Unexpected error in the app", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="mx-auto max-w-md space-y-4 px-4 py-12 text-slate-900 dark:text-slate-100">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="text-sm">
          The page stopped working. Reload to continue; your publication attempts are kept and
          nothing is sent again.
        </p>
        <Button onClick={this.props.onReload ?? reloadPage}>Reload</Button>
      </main>
    );
  }
}
