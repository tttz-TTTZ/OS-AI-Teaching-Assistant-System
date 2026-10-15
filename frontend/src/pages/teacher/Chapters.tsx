import { useState, FormEvent } from "react";
import { teacherApi, ChapterInput, Chapter } from "../../api";
import { Page, Notice } from "../../components";
import { useRemote, Publish, Status } from "./shared";
const empty: ChapterInput = {
  title: "",
  description: "",
  course_id: 1,
  sort_order: 10,
  published: false,
};
export default function Chapters() {
  const { data, error, loading, refresh, setError } = useRemote(
    teacherApi.chapters,
    [] as Chapter[],
  );
  const [form, setForm] = useState(empty);
  const [id, setId] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuccess("");
    try {
      await teacherApi.saveChapter(form, id);
      await refresh();
      setForm({ ...empty });
      setId(undefined);
      setSuccess("章节已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(row: Chapter) {
    if (!confirm(`删除空章节“${row.title}”？有关联内容时会拒绝删除。`)) return;
    setBusy(true);
    setSuccess("");
    try {
      await teacherApi.deleteChapter(row.id);
      await refresh();
      if (id === row.id) {
        setId(undefined);
        setForm({ ...empty });
      }
      setSuccess("空章节已删除");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="章节管理">
      <Notice error={error} />
      {success && (
        <p role="status" className="feedback">
          {success}
        </p>
      )}
      <div className="management">
        <section className="panel">
          <h2>课程章节</h2>
          {loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>顺序</th>
                    <th>章节</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((c) => (
                    <tr key={c.id}>
                      <td>{c.sort_order}</td>
                      <td>{c.title}</td>
                      <td>
                        <Status value={c.published} />
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => {
                            setId(c.id);
                            setForm(c);
                            setSuccess("");
                          }}
                        >
                          编辑
                        </button>{" "}
                        <button
                          disabled={busy}
                          className="danger"
                          onClick={() => void remove(c)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.length && <p>暂无章节</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>{id ? "编辑章节" : "新增章节"}</h2>
          <form onSubmit={submit}>
            <label>
              章节标题
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              章节说明
              <textarea
                maxLength={5000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label>
              排序（数字越小越靠前）
              <input
                required
                type="number"
                min="0"
                max="100000"
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
              />
            </label>
            <Publish
              value={form.published}
              onChange={(v) => setForm({ ...form, published: v })}
            />
            <div className="toolbar">
              <button disabled={busy}>保存章节</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setId(undefined);
                  setForm({ ...empty });
                }}
              >
                新建 / 取消编辑
              </button>
            </div>
          </form>
        </section>
      </div>
    </Page>
  );
}
