import { FormEvent, useEffect, useState } from "react";
import { Chapter, teacherApi } from "../../api";
import { Content, digitalApi } from "../../digital";
import { StudyQuestion, studyApi, typeNames } from "../../study";
import { Page, Notice } from "../../components";
const empty = (): StudyQuestion => ({
  chapter_id: 0,
  prompt: "",
  kind: "single",
  options: ["", ""],
  items: [],
  correct: 0,
  explanation: "",
  published: false,
  knowledge_ids: [],
});
export default function Questions() {
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [points, setPoints] = useState<Content[]>([]);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function refresh() {
    const [qs, cs, ps] = await Promise.all([
      studyApi.teacher(),
      teacherApi.chapters(),
      digitalApi.teacherList(),
    ]);
    setQuestions(qs);
    setChapters(cs);
    setPoints(ps);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  function kind(value: StudyQuestion["kind"]) {
    setForm({
      ...form,
      kind: value,
      options: value === "boolean" ? ["正确", "错误"] : form.options,
      correct:
        value === "short"
          ? ""
          : value === "multiple"
            ? []
            : value === "matching"
              ? [0]
              : 0,
      items: value === "matching" ? ["待分类项"] : [],
    });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await studyApi.save(form);
      await refresh();
      setForm(empty());
      setMessage("练习题已保存");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selection = (value: number, onChange: (n: number) => void) => (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {form.options.map((o, i) => (
        <option key={i} value={i}>
          {String.fromCharCode(65 + i)}. {o}
        </option>
      ))}
    </select>
  );
  return (
    <Page title="练习题管理">
      <p>
        同一题库支持知识点关联。多选完全匹配计分；简答提供参考答案，暂不自动评分。
      </p>
      <Notice error={error} />
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      <div className="management">
        <section className="panel">
          <h2>课程题库</h2>
          {questions.map((q) => (
            <div className="resource" key={q.id}>
              <span>
                {typeNames[q.kind]} · {q.published ? "已发布" : "草稿"} ·{" "}
                {q.prompt}
              </span>
              <button
                className="secondary"
                onClick={() => setForm(structuredClone(q))}
              >
                编辑
              </button>
            </div>
          ))}
        </section>
        <section className="panel editor-area">
          <h2>{form.id ? "编辑题目" : "新增题目"}</h2>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <label>
                所属章节
                <select
                  aria-label="所属章节"
                  required
                  value={form.chapter_id || ""}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      chapter_id: Number(e.target.value),
                      knowledge_ids: [],
                    })
                  }
                >
                  <option value="">请选择</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                题型
                <select
                  aria-label="题型"
                  value={form.kind}
                  onChange={(e) =>
                    kind(e.target.value as StudyQuestion["kind"])
                  }
                >
                  {Object.entries(typeNames).map(([key, title]) => (
                    <option key={key} value={key}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                题干
                <textarea
                  aria-label="题干"
                  required
                  maxLength={2000}
                  value={form.prompt}
                  onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                />
              </label>
              {!["short", "boolean"].includes(form.kind) && (
                <>
                  {form.options.map((option, i) => (
                    <label key={i}>
                      选项 {String.fromCharCode(65 + i)}
                      <input
                        required
                        maxLength={1000}
                        value={option}
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
                    type="button"
                    className="secondary"
                    disabled={form.options.length >= 8}
                    onClick={() =>
                      setForm({ ...form, options: [...form.options, ""] })
                    }
                  >
                    增加选项
                  </button>
                </>
              )}
              {["single", "boolean"].includes(form.kind) && (
                <label>
                  正确选项
                  {selection(Number(form.correct), (correct) =>
                    setForm({ ...form, correct }),
                  )}
                </label>
              )}
              {form.kind === "multiple" && (
                <fieldset>
                  <legend>正确选项（可多选）</legend>
                  {form.options.map((o, i) => (
                    <label className="check" key={i}>
                      <input
                        type="checkbox"
                        checked={(form.correct as number[]).includes(i)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            correct: e.target.checked
                              ? [...(form.correct as number[]), i]
                              : (form.correct as number[]).filter(
                                  (v) => v !== i,
                                ),
                          })
                        }
                      />
                      {String.fromCharCode(65 + i)}. {o}
                    </label>
                  ))}
                </fieldset>
              )}
              {form.kind === "short" && (
                <label>
                  参考答案与要点
                  <textarea
                    aria-label="参考答案与要点"
                    required
                    maxLength={5000}
                    value={String(form.correct)}
                    onChange={(e) =>
                      setForm({ ...form, correct: e.target.value })
                    }
                  />
                </label>
              )}
              {form.kind === "matching" && (
                <>
                  {form.items.map((item, i) => (
                    <div key={i}>
                      <label>
                        待匹配项 {i + 1}
                        <input
                          required
                          maxLength={500}
                          value={item}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              items: form.items.map((v, j) =>
                                j === i ? e.target.value : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        正确分类 {i + 1}
                        {selection(
                          (form.correct as number[])[i] || 0,
                          (answer) =>
                            setForm({
                              ...form,
                              correct: (form.correct as number[]).map((v, j) =>
                                j === i ? answer : v,
                              ),
                            }),
                        )}
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary"
                    disabled={form.items.length >= 10}
                    onClick={() =>
                      setForm({
                        ...form,
                        items: [...form.items, ""],
                        correct: [...(form.correct as number[]), 0],
                      })
                    }
                  >
                    增加匹配项
                  </button>
                </>
              )}
              <label>
                解析
                <textarea
                  aria-label="解析"
                  maxLength={5000}
                  value={form.explanation}
                  onChange={(e) =>
                    setForm({ ...form, explanation: e.target.value })
                  }
                />
              </label>
              <label>
                关联知识点（可多选）
                <select
                  aria-label="关联知识点（可多选）"
                  multiple
                  value={form.knowledge_ids.map(String)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      knowledge_ids: Array.from(e.target.selectedOptions, (o) =>
                        Number(o.value),
                      ),
                    })
                  }
                >
                  {points
                    .filter((p) => p.chapter_id === form.chapter_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.code} {p.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.published}
                  onChange={(e) =>
                    setForm({ ...form, published: e.target.checked })
                  }
                />
                发布给学生
              </label>
              <div className="toolbar">
                <button disabled={busy}>保存题目</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setForm(empty())}
                >
                  新建 / 取消编辑
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </Page>
  );
}
