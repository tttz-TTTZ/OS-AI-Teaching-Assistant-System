import { useState, FormEvent } from "react";
import { teacherApi, ManagedQuestion, Chapter } from "../../api";
import { Page, Notice } from "../../components";
import { useRemote, Publish, Status } from "./shared";
const empty: Omit<ManagedQuestion, "id"> = {
  chapter_id: 0,
  prompt: "",
  options: ["", ""],
  answer: 0,
  explanation: "",
  published: false,
};
export default function Questions() {
  const items = useRemote(teacherApi.questions, [] as ManagedQuestion[]);
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
      await teacherApi.saveQuestion(form, id);
      await items.refresh();
      setId(undefined);
      setForm({ ...empty, options: ["", ""] });
      setSuccess("练习题已保存");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="练习题管理">
      <Notice error={items.error || chapters.error} />
      {success && (
        <p role="status" className="feedback">
          {success}
        </p>
      )}
      <div className="management">
        <section className="panel">
          <h2>人工单选题</h2>
          {items.loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>题目</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((q) => (
                    <tr key={q.id}>
                      <td>{q.prompt}</td>
                      <td>
                        <Status value={q.published} />
                      </td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() => {
                            setId(q.id);
                            setForm(q);
                          }}
                        >
                          编辑
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.data.length && <p>暂无题目</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>{id ? "编辑题目" : "新增题目"}</h2>
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
              题干
              <textarea
                required
                maxLength={2000}
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
              />
            </label>
            {form.options.map((o, i) => (
              <label key={i}>
                选项 {String.fromCharCode(65 + i)}
                <input
                  required
                  maxLength={1000}
                  value={o}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      options: form.options.map((v, j) =>
                        j === i ? e.target.value : v,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              className="secondary"
              type="button"
              disabled={form.options.length >= 8}
              onClick={() =>
                setForm({ ...form, options: [...form.options, ""] })
              }
            >
              增加选项
            </button>
            <label>
              正确选项
              <select
                value={form.answer}
                onChange={(e) =>
                  setForm({ ...form, answer: Number(e.target.value) })
                }
              >
                {form.options.map((_, i) => (
                  <option value={i} key={i}>
                    {String.fromCharCode(65 + i)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              解析
              <textarea
                maxLength={5000}
                value={form.explanation}
                onChange={(e) =>
                  setForm({ ...form, explanation: e.target.value })
                }
              />
            </label>
            <Publish
              value={form.published}
              onChange={(v) => setForm({ ...form, published: v })}
            />
            <div className="toolbar">
              <button disabled={busy}>保存题目</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setId(undefined);
                  setForm({ ...empty, options: ["", ""] });
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
