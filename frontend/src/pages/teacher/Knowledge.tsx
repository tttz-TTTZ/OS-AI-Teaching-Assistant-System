import { useState, FormEvent } from "react";
import {
  teacherApi,
  KnowledgeInput,
  Knowledge as Item,
  Chapter,
} from "../../api";
import { Page, Notice } from "../../components";
import { useRemote, Publish, Status } from "./shared";
const empty: KnowledgeInput = {
  title: "",
  content: "",
  chapter_id: 0,
  lab_path: null,
  published: false,
};
export default function Knowledge() {
  const items = useRemote(teacherApi.knowledge, [] as Item[]);
  const chapters = useRemote(teacherApi.chapters, [] as Chapter[]);
  const [form, setForm] = useState(empty);
  const [id, setId] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSuccess("");
    try {
      await teacherApi.saveKnowledge(form, id);
      await items.refresh();
      setId(undefined);
      setForm({ ...empty });
      setSuccess("知识点已保存");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="知识点管理">
      <Notice error={items.error || chapters.error} />
      {success && (
        <p role="status" className="feedback">
          {success}
        </p>
      )}
      <div className="management">
        <section className="panel">
          <h2>知识点列表</h2>
          {items.loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>知识点</th>
                    <th>章节</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((k) => (
                    <tr key={k.id}>
                      <td>{k.title}</td>
                      <td>
                        {
                          chapters.data.find((c) => c.id === k.chapter_id)
                            ?.title
                        }
                      </td>
                      <td>
                        <Status value={k.published} />
                      </td>
                      <td>
                        <button
                          disabled={busy}
                          className="secondary"
                          onClick={() => {
                            setId(k.id);
                            setForm(k);
                          }}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.data.length && <p>暂无知识点</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>{id ? "编辑知识点" : "新增知识点"}</h2>
          <form onSubmit={submit}>
            <label>
              所属章节
              <select
                aria-label="所属章节"
                required
                value={form.chapter_id || ""}
                onChange={(e) =>
                  setForm({ ...form, chapter_id: Number(e.target.value) })
                }
              >
                <option value="">请选择</option>
                {chapters.data.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              知识点标题
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              正文（支持基础 Markdown）
              <textarea
                required
                className="editor"
                maxLength={50000}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!!form.lab_path}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lab_path: e.target.checked ? "/student/experiments" : null,
                  })
                }
              />
              关联 FCFS 实验
            </label>
            <Publish
              value={form.published}
              onChange={(v) => setForm({ ...form, published: v })}
            />
            <div className="toolbar">
              <button disabled={busy}>保存知识点</button>
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
