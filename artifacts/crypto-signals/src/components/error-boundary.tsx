import { Component, ErrorInfo, ReactNode } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] caught:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-24 gap-6 text-center px-4">
          <div className="w-16 h-16 rounded-full bg-danger/10 border border-danger/30 flex items-center justify-center">
            <AlertTriangle className="h-7 w-7 text-danger" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold">Errore di rendering</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              {this.props.fallbackLabel ?? "Si è verificato un errore nel caricamento di questa pagina."}
            </p>
            {this.state.error && (
              <p className="text-xs font-mono text-danger/70 bg-danger/5 border border-danger/20 rounded p-2 max-w-lg break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={this.handleReset} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" />
              Riprova
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()} className="gap-2">
              Ricarica pagina
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
