import { FormEvent, useEffect, useState } from "react";
import { Chapter, teacherApi } from "../../api";
import {
  Content,
  digitalApi,
  newContent,
  Revision,
  Section,
} from "../../digital";
import { Page, Notice } from "../../components";
import ContentView from "../../learning/ContentView";
import { studyApi } from "../../study";
import BlockEditor from "../../learning/BlockEditor";

export default function Knowledge() {
  const [items, setItems] = useState<Content[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [form, setForm] = useState<Content>(newContent);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<Revision[]>([]);
  const [query, setQuery] = useState("");
  const [summary, setSummary] =
    useState<Awaited<ReturnType<typeof studyApi.summary>>>();
  const [autosave, setAutosave] = useState(true);
  const emptySection = {
    chapter_id: 0,
    code: "",
    title: "",
    sort_order: 0,
    published: false,
  };
  const [sectionForm, setSectionForm] = useState(emptySection);
  const [sectionId, setSectionId] = useState<number>();
  async function refresh() {
    const [points, chs, secs] = await Promise.all([
      digitalApi.teacherList(),
      teacherApi.chapters(),
      digitalApi.sections(),
    ]);
    setItems(points);
    setChapters(chs);
    setSections(secs);
  }
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    if (
      !autosave ||
      !dirty ||
      busy ||
      !form.id ||
      !form.title.trim() ||
      !form.chapter_id
    )
      return;
    const timer = setTimeout(async () => {
      setBusy(true);
      setError("");
      try {
        const saved = await digitalApi.save(form);
        setForm(saved);
        setDirty(false);
        setSuccess("草稿已自动保存；学生版本未改变");
        await refresh();
      } catch (e) {
        setError("自动保存暂停：" + (e as Error).message);
        setAutosave(false);
      } finally {
        setBusy(false);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [form, dirty, busy, autosave]);
  function change(next: Content) {
    setForm(next);
    setDirty(true);
    setSuccess("");
  }
  function edit(next: Content) {
    if (busy) return;
    if (dirty && !confirm("尚有未保存内容，确定放弃并切换？")) return;
    setForm(structuredClone(next));
    setDirty(false);
    setPreview(false);
    setHistory([]);
    setError("");
    setSuccess("");
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const saved = await digitalApi.save(form);
      setForm(saved);
      setDirty(false);
      setSuccess("知识点草稿已保存，学生仍读取上次发布版本");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(
    kind: "publish" | "withdraw" | "archive" | "restore",
    revision?: number,
  ) {
    if (!form.id) return;
    setBusy(true);
    setError("");
    try {
      const result = await digitalApi.action(
        form.id,
        kind,
        form.edit_version || 0,
        revision,
      );
      await refresh();
      if (kind === "restore") {
        const restored = result as unknown as Content;
        setForm(restored);
        setDirty(false);
      } else {
        setForm({
          ...form,
          edit_version: result.edit_version,
          published: kind === "publish",
          archived: kind === "archive",
        });
      }
      setHistory([]);
      setSuccess(
        kind === "publish"
          ? "知识点已发布"
          : kind === "restore"
            ? "历史版本已恢复为草稿，请审阅后发布"
            : "内容已撤回，原数据仍保留",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="知识点管理">
      <section className="panel compact">
        <h2>数字教材工作台</h2>
        <p>
          章、节、教学编号、来源及页码均可修改或留待核对。保存草稿不会改变学生正在阅读的版本；发布前请检查内容。
        </p>
      </section>
      <details className="panel compact">
        <summary>查看真实学习情况与主动反馈</summary>
        <button
          className="secondary"
          onClick={async () => {
            try {
              setSummary(await studyApi.summary());
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          加载学习反馈
        </button>
        {summary && (
          <>
            <p>
              已记录作答 {summary.attempts}{" "}
              次。下列掌握数据仅是学生自评，不是考试成绩。
            </p>
            {!summary.progress.length && <p>暂无当前版本学习记录。</p>}
            <table>
              <thead>
                <tr>
                  <th>知识点</th>
                  <th>已保存记录人数</th>
                  <th>已阅读</th>
                  <th>自评掌握</th>
                </tr>
              </thead>
              <tbody>
                {summary.progress.map((p) => (
                  <tr key={p.point_id}>
                    <td>{p.title}</td>
                    <td>{p.learners}</td>
                    <td>{p.read_count}</td>
                    <td>{p.self_assessed_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.feedback.map((f) => (
              <div className="resource" key={f.id}>
                <strong>
                  {f.title} · {f.username}
                </strong>
                <p>{f.message}</p>
                <small>{f.created_at}</small>
              </div>
            ))}
          </>
        )}
      </details>
      <Notice error={error} />
      {success && (
        <p className="feedback" role="status">
          {success}
        </p>
      )}
      <div className="content-workspace">
        <aside className="panel content-list">
          <h2>知识点目录</h2>
          <input
            aria-label="筛选知识点"
            placeholder="搜索编号、标题"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => edit(newContent())}
          >
            新增知识点
          </button>
          {items
            .filter((p) => (p.code + " " + p.title).includes(query))
            .sort(
              (a, b) =>
                a.chapter_id - b.chapter_id || a.sort_order - b.sort_order,
            )
            .map((p) => (
              <button
                key={p.id}
                className={
                  "content-item " + (form.id === p.id ? "selected" : "")
                }
                onClick={() => edit(p)}
              >
                <strong>
                  {p.code} {p.title}
                </strong>
                <small>
                  {chapters.find((c) => c.id === p.chapter_id)?.title} ·{" "}
                  {p.archived
                    ? "已归档"
                    : p.published
                      ? "有已发布版本"
                      : "草稿"}
                </small>
              </button>
            ))}
          {!items.length && <p>暂无知识点，可从右侧创建。</p>}
          <details>
            <summary>小节目录管理（可自由修改）</summary>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await digitalApi.saveSection(sectionForm, sectionId);
                  await refresh();
                  setSectionForm(emptySection);
                  setSectionId(undefined);
                  setSuccess("小节已保存");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                小节所属章
                <select
                  aria-label="小节所属章"
                  required
                  value={sectionForm.chapter_id || ""}
                  onChange={(e) =>
                    setSectionForm({
                      ...sectionForm,
                      chapter_id: Number(e.target.value),
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
                小节编号
                <input
                  maxLength={80}
                  value={sectionForm.code}
                  onChange={(e) =>
                    setSectionForm({ ...sectionForm, code: e.target.value })
                  }
                />
              </label>
              <label>
                小节标题
                <input
                  required
                  maxLength={200}
                  value={sectionForm.title}
                  onChange={(e) =>
                    setSectionForm({ ...sectionForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                小节顺序
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={sectionForm.sort_order}
                  onChange={(e) =>
                    setSectionForm({
                      ...sectionForm,
                      sort_order: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={sectionForm.published}
                  onChange={(e) =>
                    setSectionForm({
                      ...sectionForm,
                      published: e.target.checked,
                    })
                  }
                />
                发布小节
              </label>
              <button disabled={busy}>保存小节</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSectionId(undefined);
                  setSectionForm(emptySection);
                }}
              >
                新建小节
              </button>
            </form>
            {sections.map((s) => (
              <button
                key={s.id}
                className="content-item"
                onClick={() => {
                  setSectionId(s.id);
                  setSectionForm(s);
                }}
              >
                {s.code} {s.title} · {s.published ? "已发布" : "草稿"}
              </button>
            ))}
          </details>
        </aside>
        <section className="panel editor-area">
          <div className="toolbar">
            <h2>{form.id ? "编辑知识点" : "新增知识点"}</h2>
            <span className="badge">
              {!form.id ? "尚未创建" : dirty ? "尚未保存" : "草稿已同步"}
            </span>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
            />
            自动保存已创建知识点的草稿（停笔2秒）
          </label>
          <form onSubmit={save}>
            <fieldset disabled={busy}>
              <legend>基本信息与灵活归属</legend>
              <div className="editor-grid">
                <label>
                  所属章节
                  <select
                    aria-label="所属章节"
                    required
                    value={form.chapter_id || ""}
                    onChange={(e) =>
                      change({
                        ...form,
                        chapter_id: Number(e.target.value),
                        section_id: null,
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
                  所属小节
                  <select
                    aria-label="所属小节"
                    value={form.section_id || ""}
                    onChange={(e) =>
                      change({
                        ...form,
                        section_id: e.target.value
                          ? Number(e.target.value)
                          : null,
                      })
                    }
                  >
                    <option value="">暂不分节</option>
                    {sections
                      .filter((s) => s.chapter_id === form.chapter_id)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} {s.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  教学编号
                  <input
                    maxLength={80}
                    placeholder="可留空或待校对"
                    value={form.code}
                    onChange={(e) => change({ ...form, code: e.target.value })}
                  />
                </label>
                <label>
                  知识点标题
                  <input
                    required
                    maxLength={200}
                    value={form.title}
                    onChange={(e) => change({ ...form, title: e.target.value })}
                  />
                </label>
                <label>
                  排序
                  <input
                    type="number"
                    min={0}
                    max={100000}
                    value={form.sort_order}
                    onChange={(e) =>
                      change({ ...form, sort_order: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  建议分钟
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={form.minutes ?? ""}
                    onChange={(e) =>
                      change({
                        ...form,
                        minutes: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <label>
                  重点/难点标签
                  <input
                    maxLength={80}
                    value={form.emphasis}
                    onChange={(e) =>
                      change({ ...form, emphasis: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                摘要
                <textarea
                  aria-label="摘要"
                  maxLength={2000}
                  value={form.summary}
                  onChange={(e) => change({ ...form, summary: e.target.value })}
                />
              </label>
              <label>
                学习目标
                <textarea
                  aria-label="学习目标"
                  maxLength={5000}
                  value={form.objectives}
                  onChange={(e) =>
                    change({ ...form, objectives: e.target.value })
                  }
                />
              </label>
              <details>
                <summary>来源、页码与相关知识</summary>
                <label>
                  来源书名/PPT名称
                  <input
                    maxLength={500}
                    value={form.source_title}
                    onChange={(e) =>
                      change({ ...form, source_title: e.target.value })
                    }
                  />
                </label>
                <div className="editor-grid">
                  <label>
                    教材印刷页码
                    <input
                      maxLength={200}
                      placeholder="如 1–12、待核对"
                      value={form.printed_pages}
                      onChange={(e) =>
                        change({ ...form, printed_pages: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    PDF实际页序
                    <input
                      maxLength={200}
                      placeholder="可稍后补充"
                      value={form.pdf_pages}
                      onChange={(e) =>
                        change({ ...form, pdf_pages: e.target.value })
                      }
                    />
                  </label>
                </div>
                <label>
                  来源与口径说明
                  <textarea
                    aria-label="来源与口径说明"
                    maxLength={3000}
                    value={form.source_note}
                    onChange={(e) =>
                      change({ ...form, source_note: e.target.value })
                    }
                  />
                </label>
                <label>
                  相关知识点
                  <select
                    aria-label="相关知识点"
                    multiple
                    value={form.related_ids.map(String)}
                    onChange={(e) =>
                      change({
                        ...form,
                        related_ids: Array.from(e.target.selectedOptions, (o) =>
                          Number(o.value),
                        ),
                      })
                    }
                  >
                    {items
                      .filter((p) => p.id !== form.id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.title}
                        </option>
                      ))}
                  </select>
                </label>
              </details>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const missing = newContent().blocks.filter(
                    (b) =>
                      !form.blocks.some((existing) => existing.kind === b.kind),
                  );
                  change({ ...form, blocks: [...form.blocks, ...missing] });
                }}
              >
                补齐教案内容模块（保留已有正文）
              </button>
              <BlockEditor
                form={form}
                change={change}
                setBusy={setBusy}
                setError={setError}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.lab}
                  onChange={(e) => change({ ...form, lab: e.target.checked })}
                />
                关联 FCFS 实验
              </label>
              <p>
                正式题目请在“练习题管理”选择关联知识点，学生从阅读页跳转统一作答。
              </p>
              <div className="toolbar">
                <button disabled={busy}>保存知识点</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPreview((p) => !p)}
                >
                  {preview ? "关闭预览" : "学生视角预览"}
                </button>
                {form.id && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const copy = {
                        ...structuredClone(form),
                        id: undefined,
                        edit_version: 0,
                        revision_id: 0,
                        published: false,
                        title: form.title + "（副本）",
                      };
                      change(copy);
                      setHistory([]);
                    }}
                  >
                    复制为新草稿
                  </button>
                )}
              </div>
            </fieldset>
          </form>
          {form.id && (
            <div className="publication-bar">
              <p>
                当前编辑版本 {form.edit_version} ·{" "}
                {form.published ? "已有上线版本" : "尚未发布/已撤回"}
                。发布前先保存；来源页码可留空。
              </p>
              <div className="toolbar">
                <button
                  disabled={busy || dirty}
                  onClick={() => action("publish")}
                >
                  发布当前草稿
                </button>
                <button
                  disabled={busy || dirty || !form.published}
                  className="secondary"
                  onClick={() => action("withdraw")}
                >
                  撤回发布
                </button>
                <button
                  disabled={busy || dirty}
                  className="secondary"
                  onClick={async () => {
                    try {
                      setHistory(await digitalApi.history(form.id!));
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  历史版本
                </button>
                <button
                  disabled={busy || dirty}
                  className="danger"
                  onClick={() => {
                    if (confirm("归档后学生不可见，内容和历史记录保留。确定？"))
                      action("archive");
                  }}
                >
                  归档知识点
                </button>
              </div>
              {history.map((r) => (
                <details key={r.id}>
                  <summary>
                    修订 #{r.id} · {r.created_at}{" "}
                    {r.is_published ? "（已发布）" : ""}
                  </summary>
                  <p>
                    {r.body.title} · {r.body.code} · 教材{" "}
                    {r.body.printed_pages || "未填"} / PDF{" "}
                    {r.body.pdf_pages || "未填"}
                  </p>
                  <ContentView content={r.body} preview />
                  <button
                    disabled={busy || dirty}
                    onClick={() => action("restore", r.id)}
                  >
                    恢复为新草稿
                  </button>
                </details>
              ))}
            </div>
          )}
          {preview && (
            <section className="preview-pane">
              <p className="notice">
                教师预览，不对学生公开。交互预览请先保存草稿。
              </p>
              <ContentView
                key={form.id + "-" + form.revision_id}
                content={form}
                preview
              />
            </section>
          )}
        </section>
      </div>
    </Page>
  );
}
