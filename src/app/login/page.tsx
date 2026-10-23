"use client";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, action, busy] = useActionState(login, undefined);
  return (
    <div className="login">
      <div className="brand" style={{ padding: 0, marginBottom: 8 }}><span className="dot" style={{ width: 10, height: 10, borderRadius: 5, background: "var(--green)", display: "inline-block" }} /> <b>Fernleaf Ops</b></div>
      <h1>Sign in</h1>
      <p className="sub">Approvals are recorded under your name.</p>
      <form action={action}>
        <input type="text" name="user" placeholder="Username" autoComplete="username" required />
        <input type="password" name="password" placeholder="Password" autoComplete="current-password" required />
        {error ? <div className="flash err">{error}</div> : null}
        <button className="btn btn-dark" type="submit" disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
    </div>
  );
}
