import { useState, FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { authApi } from "../api";
import { Notice } from "../components";
export default function Login({ register = false }: { register?: boolean }) {
  const { user, loading, error: initial, login } = useAuth();
  const [params] = useSearchParams();
  const role = !register && params.get("role") === "teacher" ? "teacher" : "student";
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (register && password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      if (register) {
        await authApi.register(name.trim(), password);
        navigate("/login?role=student&registered=1", { replace: true });
      } else {
        await login(name.trim(), password, role);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setPassword("");
      setConfirm("");
    }
  }
  if (loading) return <p className="empty">正在恢复登录状态…</p>;
  if (user) return <Navigate replace to={`/${user.role}/dashboard`} />;
  return (
    <div className="login">
      <section className="panel">
        <span className="badge">OS / ASSISTANT · V0.2</span>
        {!register && <nav className="login-portals" aria-label="选择登录入口">
          <Link to="/login?role=student" aria-current={role === "student" ? "page" : undefined}>学生端</Link>
          <Link to="/login?role=teacher" aria-current={role === "teacher" ? "page" : undefined}>教师端</Link>
        </nav>}
        <h1>{register ? "注册学生账号" : role === "teacher" ? "教师登录" : "学生登录"}</h1>
        <p>{register ? "创建账号后即可登录，查看课程内容并管理自己的资料。" : role === "teacher" ? "请使用管理员分配的教师账号，教师不开放自行注册。" : "登录学习课程；首次使用可自行注册学生账号。"}</p>
        {params.get("registered") === "1" && !register && <p role="status">注册成功，请使用刚创建的账号登录。</p>}
        <Notice error={error || (register ? "" : initial)} />
        <form onSubmit={submit}>
          <label htmlFor="username">用户名</label>
          <input id="username" required maxLength={80} autoComplete="username"
            value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="password">密码</label>
          <input id="password" type="password" required minLength={register ? 12 : undefined}
            maxLength={128} autoComplete={register ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {register && <>
            <p className="hint">密码为 12–128 个字符，请勿与其他网站共用密码。</p>
            <label htmlFor="confirm-password">确认密码</label>
            <input id="confirm-password" type="password" required minLength={12} maxLength={128}
              autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>}
          <button disabled={busy}>{busy ? (register ? "注册中…" : "登录中…") : (register ? "注册学生账号" : "登录")}</button>
        </form>
        <p className="hint">{register
          ? <Link to="/login?role=student">已有账号，返回学生登录</Link>
          : role === "student" ? <Link to="/register">没有账号？注册学生账号</Link>
          : "教师账号由管理员创建和分配；忘记密码请联系管理员。"}</p>
      </section>
    </div>
  );
}
