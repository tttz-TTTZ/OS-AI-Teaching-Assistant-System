import { FormEvent, useEffect, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, teacherApi } from "../../api";
import { Content, digitalApi } from "../../digital";
import { StudyQuestion, studyApi, typeNames } from "../../study";
import { Notice } from "../../components";
import { AuthoringPage } from "./Authoring";
import { AIDraft, aiQuestionApi } from "../../aiQuestions";
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
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<AIDraft>();
  const [reviewed, setReviewed] = useState(false);
  const [lastAIJob, setLastAIJob] = useState<number>();
  const aiId = Number(params.get("aiDraft"));
  useEffect(() => {
    let active = true;
    setDraft(undefined);
    setReviewed(false);
    if (aiId)
      aiQuestionApi
        .draft(aiId)
        .then((value) => {
          if (!active) return;
          if (value.status !== "pending") {
            setError("该候选题已处理，请返回AI任务记录查看。");
            return;
          }
          setDraft(value);
          setLastAIJob(value.job_id);
          setForm({ ...value.question, published: false });
          setMessage("已自动填写候选题，请核对题干、答案、解析与资料依据。");
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [aiId]);
  const initialized = useRef(false);
  useEffect(() => {
    const selected = points.find(
      (p) => p.id === Number(params.get("knowledge")),
    );
    if (selected && !initialized.current) {
      setForm({
        ...empty(),
        chapter_id: selected.chapter_id,
        knowledge_ids: [selected.id!],
      });
      initialized.current = true;
    }
  }, [points, params]);
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
      if (draft) {
        const saved = await aiQuestionApi.import(
          draft,
          { ...form, published: false },
          reviewed,
        );
        await refresh();
        setForm(saved);
        setParams({});
        setDraft(undefined);
        setReviewed(false);
        setMessage(
          "已审核并存入题库草稿；学生尚不可见。需要发布时，请勾选发布给学生，再保存题目。",
        );
      } else {
        await studyApi.save(form);
        await refresh();
        setForm(empty());
        setMessage("练习题已保存");
      }
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
    <AuthoringPage title={aiId ? "核对并修改这道题" : "练习题管理"}>
      {!aiId && (
        <>
          <p>
            同一题库支持知识点关联。多选完全匹配计分；简答提供参考答案，暂不自动评分。
          </p>
          <p>
            <Link className="button" to="/teacher/ai-questions">
              使用DeepSeek辅助出题 →
            </Link>
          </p>
        </>
      )}
      {draft && (
        <section className="panel ai-review-evidence">
          <h2>AI候选题审核 · #{draft.id}</h2>
          <p>
            模型 {draft.model} · 来源：{draft.source?.title} · 第
            {draft.source?.page}页
          </p>
          <blockquote>{draft.source_quote}</blockquote>
          <details>
            <summary>查看当时发送的原文摘录</summary>
            <pre className="ai-source-text">{draft.source?.text}</pre>
          </details>
          <p>
            引用存在不代表答案一定正确。请逐项检查；审核后只保存为题库草稿。
          </p>
          <Link to={`/teacher/ai-questions?step=review&job=${draft.job_id}`}>
            返回本批候选题 →
          </Link>
        </section>
      )}
      <Notice error={error} />
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      {lastAIJob && !draft && (
        <p>
          <Link
            className="button secondary"
            to={`/teacher/ai-questions?step=review&job=${lastAIJob}`}
          >
            继续审核本批候选题 →
          </Link>
        </p>
      )}
      <div className={"management" + (aiId ? " ai-review" : "")}>
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
          <h2>
            {aiId
              ? draft
                ? "修改并审核候选题"
                : "正在读取AI候选题…"
              : form.id
                ? "编辑题目"
                : "新增题目"}
          </h2>
          <form onSubmit={save}>
            <fieldset disabled={busy || (!!aiId && !draft)}>
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
              {!draft && (
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
              )}
              {draft && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  我已核对题干、选项、答案、解析和资料依据
                </label>
              )}
              <div className="toolbar">
                <button disabled={busy || (!!draft && !reviewed)}>
                  {draft ? "审核通过，存为题库草稿" : "保存题目"}
                </button>
                {draft && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      setError("");
                      try {
                        const result = await aiQuestionApi.save(draft, {
                          ...form,
                          published: false,
                        });
                        setDraft({ ...draft, version: result.version });
                        setMessage("候选修改已保存，仍未加入题库");
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    保存候选修改
                  </button>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setForm(empty());
                    setDraft(undefined);
                    setParams({});
                  }}
                >
                  新建 / 取消编辑
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    </AuthoringPage>
  );
}
