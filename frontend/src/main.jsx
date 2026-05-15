import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
// CometChat UI Kit base styles
import "@cometchat/chat-uikit-react/css-variables.css";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, fontFamily: "monospace", color: "red" }}>
          <h2>App crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>{String(this.state.error)}</pre>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#555" }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
