import { useState, FormEvent } from "react";
import { accountApi } from "../api";
import { useAuth } from "../auth";
import { Page, Notice } from "../components";
export default function Profile() {
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirm) {
      setError("两次新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await accountApi.password(current, password);
      setCurrent("");
      setPassword("");
      setConfirm("");
      setMessage("密码已修改，其他会话已退出；当前标签保持登录。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="个人账号">
      <section className="panel accountform">
        <p>
          账号：{user?.username} · {user?.role === "teacher" ? "教师" : "学生"}
          {user?.is_admin ? " / 账号管理员" : ""}
        </p>
        <Notice error={error} />
        {message && (
          <p className="feedback" role="status">
            {message}
          </p>
        )}
        <h2>修改本人密码</h2>
        <form onSubmit={submit}>
          <label>
            当前密码
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <button disabled={busy}>修改密码</button>
        </form>
      </section>
    </Page>
  );
}
