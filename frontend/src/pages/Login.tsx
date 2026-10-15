import { useState, FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Notice } from "../components";
export default function Login() {
  const { user, loading, error: initial, login } = useAuth();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(name, password);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  if (loading) return <p className="empty">正在恢复登录状态…</p>;
  if (user) return <Navigate replace to={`/${user.role}/dashboard`} />;
  return (
    <div className="login">
      <section className="panel">
        <span className="badge">OS / ASSISTANT · V0.2</span>
        <h1>登录课程工作空间</h1>
        <p>教师维护课程，学生探索知识。当前仅供可信本地开发。</p>
        <Notice error={error || initial} />
        <form onSubmit={submit}>
          <label htmlFor="username">用户名</label>
          <input
            id="username"
            required
            maxLength={80}
            autoComplete="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="password">密码</label>
          <input
            id="password"
            type="password"
            required
            maxLength={128}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button disabled={busy}>{busy ? "登录中…" : "登录"}</button>
        </form>
        <p className="hint">
          没有默认账号。请按 README 的本地账号初始化步骤创建教师或学生账号。
        </p>
      </section>
    </div>
  );
}
