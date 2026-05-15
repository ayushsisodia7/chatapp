import { useState } from "react";
import { login } from "../api";

/**
 * Login — simple form that takes a UID and display name.
 *
 * In a real app you'd have proper auth (password, OAuth, etc.).
 * Here we just create/upsert the user in CometChat and get an auth token.
 */
export default function Login({ onLogin }) {
  const [uid, setUid] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const cleanUid = uid.trim().toLowerCase().replace(/\s+/g, "-");
    const cleanName = name.trim();

    if (!cleanUid || !cleanName) {
      setError("Both fields are required.");
      return;
    }

    setLoading(true);
    try {
      const data = await login(cleanUid, cleanName);
      onLogin(data.uid, data.name, data.authToken);
    } catch (err) {
      setError(err.message || "Login failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h2>Friend Chat</h2>
        <p>Enter a user ID and display name to get started.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="uid">User ID</label>
            <input
              id="uid"
              type="text"
              placeholder="e.g. alice"
              value={uid}
              onChange={(e) => setUid(e.target.value)}
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="name">Display Name</label>
            <input
              id="name"
              type="text"
              placeholder="e.g. Alice"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>

          {error && <p className="error-msg">{error}</p>}
        </form>
      </div>
    </div>
  );
}
