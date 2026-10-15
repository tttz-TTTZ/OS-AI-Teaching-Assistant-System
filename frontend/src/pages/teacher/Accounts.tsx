import { useState, FormEvent } from "react";
import { accountApi, Account } from "../../api";
import { useAuth } from "../../auth";
import { Page, Notice } from "../../components";
import { useRemote } from "./shared";
export default function Accounts() {
  const { user } = useAuth();
  const records = useRemote(() => accountApi.list(), [] as Account[]);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Account>();
  const [reset, setReset] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage("");
    records.setError("");
    try {
      await fn();
      setPassword("");
      setReset("");
      setMessage(success);
      await records.refresh();
    } catch (e) {
      records.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    await action(() => accountApi.create(name, password, role), "账号已创建");
  }
  async function search(e: FormEvent) {
    e.preventDefault();
    try {
      records.setData(await accountApi.list(q));
    } catch (e) {
      records.setError((e as Error).message);
    }
  }
  return (
    <Page title="账号管理">
      <p>
        {user?.is_admin
          ? "你是账号管理员，可创建和管理教师、学生账号。"
          : "教师可管理学生账号；教师账号由本地管理员授权的账号管理员维护。"}
        停用会立即撤销该账号全部登录；资料保留，不删除账号历史。
      </p>
      <Notice error={records.error} />
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      <div className="management">
        <section className="panel">
          <h2>账号列表</h2>
          <form className="toolbar" onSubmit={search}>
            <input
              aria-label="搜索用户名"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="secondary">搜索</button>
          </form>
          {records.loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.data.map((a) => (
                    <tr key={a.id}>
                      <td>{a.username}</td>
                      <td>
                        {a.role === "teacher" ? "教师" : "学生"}
                        {a.is_admin ? " / 管理员" : ""}
                      </td>
                      <td>{a.active ? "启用" : "停用"}</td>
                      <td>
                        <button
                          className="secondary"
                          disabled={busy || a.id === user?.id}
                          onClick={() =>
                            void action(
                              () => accountApi.active(a.id, !a.active),
                              "账号状态已更新",
                            )
                          }
                        >
                          {a.active ? "停用" : "启用"}
                        </button>{" "}
                        <button
                          className="secondary"
                          disabled={busy || a.id === user?.id}
                          onClick={() => {
                            setSelected(a);
                            setReset("");
                            setMessage("");
                          }}
                        >
                          重置密码
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!records.data.length && <p>暂无可管理账号</p>}
            </div>
          )}
        </section>
        <section className="panel accountform">
          <h2>创建账号</h2>
          <form onSubmit={create}>
            <label>
              用户名
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label>
              初始密码
              <input
                required
                type="password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            {user?.is_admin && (
              <label>
                角色
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="student">学生</option>
                  <option value="teacher">教师</option>
                </select>
              </label>
            )}
            <button disabled={busy}>创建账号</button>
          </form>
          {selected && (
            <>
              <h2>重置 {selected.username} 的密码</h2>
              <p>重置成功后，该账号的所有会话失效。</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void action(
                    () => accountApi.reset(selected.id, reset),
                    "密码已重置",
                  );
                }}
              >
                <label>
                  新的临时密码
                  <input
                    type="password"
                    required
                    minLength={12}
                    maxLength={128}
                    value={reset}
                    onChange={(e) => setReset(e.target.value)}
                    autoComplete="new-password"
                  />
                </label>
                <button disabled={busy}>确认重置密码</button>
              </form>
            </>
          )}
        </section>
      </div>
    </Page>
  );
}
