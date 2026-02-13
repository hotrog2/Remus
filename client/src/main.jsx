import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || "Unknown client error" };
  }

  componentDidCatch(error) {
    // Keep visible in DevTools/terminal for debugging packaged runtime issues.
    console.error("Remus render error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="auth-shell">
          <div className="auth-card">
            <h1>Remus</h1>
            <p>Client failed to render.</p>
            <div className="error-box">Error: {this.state.message}</div>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
