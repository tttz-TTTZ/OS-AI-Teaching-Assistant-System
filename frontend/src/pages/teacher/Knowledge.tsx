import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Chapter, teacherApi } from "../../api";
import {
  blockKinds,
  Content,
  digitalApi,
  newContent,
  Revision,
  Section,
} from "../../digital";
import { Notice } from "../../components";
import { useAuthoring } from "../../learning/useAuthoring";
import BlockEditor from "../../learning/BlockEditor";
import ContentView from "../../learning/ContentView";
import { AuthoringPage, EditorSteps, editorSteps } from "./Authoring";

export default function Knowledge() {
  const { pointId, step = "settings" } = useParams();
  const id = Number(pointId);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editor = useAuthoring(id);
  const { form, change, dirty, busy, loading, error, message } = editor;
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [points, setPoints] = useState<Content[]>([]);
  const [history, setHistory] = useState<Revision[]>([]);
  useEffect(() => {
    let active = true;
    Promise.all([
      teacherApi.chapters(),
      digitalApi.sections(),
      digitalApi.teacherList(),
    ])
      .then(([cs, ss, ps]) => {
        if (active) {
          setChapters(cs);
          setSections(ss);
          setPoints(ps);
        }
      })
      .catch((e) => {
        if (active) editor.setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (step === "history")
      digitalApi
        .history(id)
        .then((h) => {
          if (active) setHistory(h);
        })
        .catch((e) => {
          if (active) editor.setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [step, id, form?.edit_version]);
  if (!editorSteps.some(([key]) => key === step))
    return <Navigate to={`/teacher/knowledge/${id}/settings`} replace />;
  const selected = params.get("block");
  const active =
    selected && form?.blocks.some((b) => b.id === selected)
      ? selected
      : "objectives";
  async function go(next: string, block?: string) {
    if (busy) return;
    if (dirty && !(await editor.save())) return;
    navigate(
      `/teacher/knowledge/${id}/${next}${block ? "?block=" + encodeURIComponent(block) : ""}`,
    );
    window.scrollTo(0, 0);
  }
  async function back() {
    if (busy) return;
    if (dirty && !(await editor.save())) return;
    navigate("/teacher/knowledge");
  }
  async function action(
    kind: "publish" | "withdraw" | "restore" | "archive",
    revision?: number,
  ) {
    if (!form || dirty || busy) return;
    editor.setBusy(true);
    editor.setError("");
    try {
      const result = await digitalApi.action(
        id,
        kind,
        form.edit_version || 0,
        revision,
      );
      const saved =
        kind === "restore"
          ? (result as unknown as Content)
          : await digitalApi.teacherDetail(id);
      editor.accept(saved);
      editor.setMessage(
        kind === "publish"
          ? "知识点已发布，学生现在可以阅读"
          : kind === "restore"
            ? "历史内容已恢复为草稿，尚未重新发布"
            : kind === "archive"
              ? "知识点已归档，历史内容保留"
              : "已撤回，学生不能再读取",
      );
      if (kind === "restore") navigate(`/teacher/knowledge/${id}/content`);
    } catch (e) {
      editor.setError((e as Error).message);
    } finally {
      editor.setBusy(false);
    }
  }
  const required = [
    "intro",
    "concept",
    "explanation",
    "case",
    "mistake",
    "summary",
  ] as const;
  const missing = form
    ? required.filter(
        (kind) => !form.blocks.some((b) => b.kind === kind && b.text.trim()),
      )
    : [];
  const currentStep = editorSteps.findIndex(([key]) => key === step);
  return (
    <AuthoringPage
      title={form?.title || "读取知识点…"}
      description={
        step === "settings"
          ? "只处理标题、归属和基本信息，正文在下一步填写。"
          : step === "content"
            ? "一次编写一个模块。通过模块导航切换，不必翻找长表单。"
            : step === "resources"
              ? "这里集中补充出处与关联，暂未校对的页码可以留空。"
              : step === "preview"
                ? "先从头阅读，再检查发布条件。确认后才会推送给学生。"
                : "历史版本独立管理，不打断日常编写。"
      }
    >
      <div className="editor-topbar">
        <button className="text-button" disabled={busy} onClick={back}>
          ← 返回知识点列表
        </button>
        <span role="status" className="save-indicator">
          {busy
            ? "正在保存或处理…"
            : dirty
              ? "有未保存修改"
              : ["草稿已保存", "草稿已自动保存"].includes(message)
                ? message
                : "草稿已保存"}
        </span>
        <div className="row-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy || !dirty}
            onClick={() => editor.save()}
          >
            保存草稿
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => editor.reload()}
          >
            重新读取
          </button>
        </div>
      </div>
      <EditorSteps
        step={step}
        disabled={busy}
        onSelect={(next) => void go(next)}
      />
      <Notice error={error} />
      {message && !["草稿已保存", "草稿已自动保存"].includes(message) && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      {loading ? (
        <p>正在读取草稿…</p>
      ) : !form ? (
        <p>未找到可编辑的知识点，请返回列表。</p>
      ) : (
        <>
          <fieldset className="authoring-editor" disabled={busy}>
            {step === "settings" && (
              <section className="authoring-card authoring-form">
                <h2>标题与课程归属</h2>
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
                  所属章节
                  <select
                    aria-label="所属章节"
                    value={form.chapter_id}
                    onChange={(e) =>
                      change({
                        ...form,
                        chapter_id: Number(e.target.value),
                        section_id: null,
                      })
                    }
                  >
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
                    value={form.section_id || 0}
                    onChange={(e) =>
                      change({
                        ...form,
                        section_id: Number(e.target.value) || null,
                      })
                    }
                  >
                    <option value="0">暂不分节</option>
                    {sections
                      .filter((s) => s.chapter_id === form.chapter_id)
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.code} {s.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  教学编号
                  <input
                    maxLength={80}
                    placeholder="例如1.1.1，也可以留空"
                    value={form.code}
                    onChange={(e) => change({ ...form, code: e.target.value })}
                  />
                </label>
                <label>
                  排列顺序
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
                  简要介绍
                  <textarea
                    aria-label="简要介绍"
                    rows={4}
                    maxLength={2000}
                    value={form.summary}
                    onChange={(e) =>
                      change({ ...form, summary: e.target.value })
                    }
                  />
                </label>
                <details className="optional-fields">
                  <summary>补充学习时长与重点标签（选填）</summary>
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
                          minutes: e.target.value
                            ? Number(e.target.value)
                            : null,
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
                </details>
              </section>
            )}
            {step === "content" && (
              <>
                <div className="module-navigation">
                  <label>
                    正在编写的模块
                    <select
                      aria-label="正在编写的模块"
                      value={
                        active === "objectives" ||
                        form.blocks.some((b) => b.id === active)
                          ? active
                          : "objectives"
                      }
                      onChange={(e) =>
                        setParams({ block: e.target.value }, { replace: true })
                      }
                    >
                      <option value="objectives">学习目标</option>
                      {form.blocks.map((b, i) => (
                        <option key={b.id} value={b.id}>
                          {i + 1}. {b.title || blockKinds[b.kind]}
                          {b.text.trim() || b.asset_id ? " ✓" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => go("preview")}
                  >
                    查看整篇效果 →
                  </button>
                </div>
                {active === "objectives" ||
                !form.blocks.some((b) => b.id === active) ? (
                  <section className="authoring-card authoring-form">
                    <span className="badge">学习目标</span>
                    <h2>学完后，学生应该能做到什么？</h2>
                    <p>每行写一个目标即可，先从最重要的一条开始。</p>
                    <label>
                      学习目标
                      <textarea
                        aria-label="学习目标"
                        rows={14}
                        maxLength={5000}
                        value={form.objectives}
                        placeholder={
                          "例如：\n理解操作系统的基本职责\n区分资源管理与服务提供"
                        }
                        onChange={(e) =>
                          change({ ...form, objectives: e.target.value })
                        }
                      />
                    </label>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        if (form.blocks[0])
                          setParams(
                            { block: form.blocks[0].id },
                            { replace: true },
                          );
                      }}
                    >
                      目标写好了，开始正文 →
                    </button>
                  </section>
                ) : (
                  <BlockEditor
                    form={form}
                    change={change}
                    setBusy={editor.setBusy}
                    setError={editor.setError}
                    activeId={active}
                    onSelect={(block) =>
                      setParams({ block }, { replace: true })
                    }
                  />
                )}
                <section className="authoring-card module-overview">
                  <h2>整篇内容导航</h2>
                  <p>只显示标题与完成情况，点击后在上方整页编辑。</p>
                  <button
                    className={
                      "module-row " +
                      (active === "objectives" ? "selected" : "")
                    }
                    type="button"
                    onClick={() => {
                      setParams({ block: "objectives" }, { replace: true });
                      window.scrollTo(0, 0);
                    }}
                  >
                    <span>学习目标</span>
                    <small>
                      {form.objectives.trim() ? "已填写" : "待填写"}
                    </small>
                  </button>
                  {form.blocks.map((b, i) => (
                    <button
                      type="button"
                      className={
                        "module-row " + (active === b.id ? "selected" : "")
                      }
                      key={b.id}
                      onClick={() => {
                        setParams({ block: b.id }, { replace: true });
                        window.scrollTo(0, 0);
                      }}
                    >
                      <span>
                        {i + 1}. {b.title || blockKinds[b.kind]}
                      </span>
                      <small>
                        {b.text.trim() || b.asset_id ? "已填写" : "待填写"}
                      </small>
                    </button>
                  ))}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      const added = newContent().blocks.filter(
                        (b) =>
                          !form.blocks.some(
                            (current) => current.kind === b.kind,
                          ),
                      );
                      change({ ...form, blocks: [...form.blocks, ...added] });
                    }}
                  >
                    补齐教案常用模块，保留已有内容
                  </button>
                </section>
                {active === "objectives" && (
                  <BlockEditor
                    form={form}
                    change={change}
                    setBusy={editor.setBusy}
                    setError={editor.setError}
                    activeId="__none__"
                    onSelect={(block) =>
                      setParams({ block }, { replace: true })
                    }
                  />
                )}
              </>
            )}
            {step === "resources" && (
              <section className="authoring-card authoring-form">
                <h2>先补来源，再决定是否关联</h2>
                <p>本页都是补充信息，不影响保存草稿，页码不确定就先留空。</p>
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
                <label>
                  教材印刷页码
                  <input
                    maxLength={200}
                    placeholder="待校对或暂不填写"
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
                    placeholder="之后可以自由修改"
                    value={form.pdf_pages}
                    onChange={(e) =>
                      change({ ...form, pdf_pages: e.target.value })
                    }
                  />
                </label>
                <label>
                  来源与口径说明
                  <textarea
                    aria-label="来源与口径说明"
                    rows={5}
                    maxLength={3000}
                    value={form.source_note}
                    onChange={(e) =>
                      change({ ...form, source_note: e.target.value })
                    }
                  />
                </label>
                <h3>相关知识点（选填）</h3>
                {points
                  .filter(
                    (p) =>
                      p.id !== id &&
                      !p.archived &&
                      chapters.find((c) => c.id === p.chapter_id)?.course_id ===
                        chapters.find((c) => c.id === form.chapter_id)
                          ?.course_id,
                  )
                  .map((p) => (
                    <label className="check" key={p.id}>
                      <input
                        type="checkbox"
                        checked={form.related_ids.includes(p.id!)}
                        onChange={(e) =>
                          change({
                            ...form,
                            related_ids: e.target.checked
                              ? [...form.related_ids, p.id!]
                              : form.related_ids.filter((v) => v !== p.id),
                          })
                        }
                      />
                      {p.code} {p.title}
                    </label>
                  ))}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={form.lab}
                    onChange={(e) => change({ ...form, lab: e.target.checked })}
                  />
                  关联 FCFS 实验
                </label>
                <p>
                  上项保留旧版 FCFS
                  分类入口。要配置完整实验及多算法关联，请进入实验管理。
                </p>
                <Link
                  className="button secondary"
                  to={`/teacher/experiments/new?knowledge=${id}`}
                >
                  为本知识点建立教学实验 →
                </Link>
                <Link className="textlink" to="/teacher/experiments">
                  管理已有算法实验 →
                </Link>
                <div className="related-task">
                  <h3>关联练习和课程资料</h3>
                  <p>
                    先保存当前草稿，再到相应页面添加。正文与练习仍使用同一知识点。
                  </p>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      if (dirty && !(await editor.save())) return;
                      navigate(`/teacher/questions?knowledge=${id}`);
                    }}
                  >
                    为本知识点添加练习 →
                  </button>
                  <Link to="/teacher/materials">管理公共资料 →</Link>
                </div>
              </section>
            )}
            {step === "preview" && (
              <>
                <section className="authoring-card full-preview">
                  <span className="badge">学生阅读预览</span>
                  <ContentView content={form} preview />
                </section>
                <section className="authoring-card publication-check">
                  <h2>发布前，确认这几项</h2>
                  <p>
                    {form.published
                      ? "学生正在阅读上次发布的版本。再次发布才会替换。"
                      : "当前是草稿，学生还不能阅读。"}
                  </p>
                  <div className="checklist">
                    {[
                      ["学习目标", !!form.objectives.trim(), "objectives"],
                      ...required.map((kind) => [
                        blockKinds[kind],
                        !missing.includes(kind),
                        form.blocks.find((b) => b.kind === kind)?.id ||
                          "objectives",
                      ]),
                    ].map(([title, ok, block]) => (
                      <div key={String(title)}>
                        <span>
                          {ok ? "✓" : "○"} {title}
                        </span>
                        {!ok && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => go("content", String(block))}
                          >
                            去填写 →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  {(!chapters.find((c) => c.id === form.chapter_id)
                    ?.published ||
                    (form.section_id &&
                      !sections.find((s) => s.id === form.section_id)
                        ?.published)) && (
                    <p className="notice">
                      所属章或小节尚未发布，请先到课程目录编辑发布状态。
                    </p>
                  )}
                  <div className="authoring-actions">
                    <button
                      disabled={
                        busy ||
                        dirty ||
                        !!missing.length ||
                        !form.objectives.trim()
                      }
                      onClick={() => action("publish")}
                    >
                      发布当前草稿
                    </button>
                    {form.published && (
                      <button
                        className="secondary"
                        disabled={busy || dirty}
                        onClick={() => {
                          if (
                            confirm(
                              "撤回后学生不能再读取，草稿和历史内容保留。确定？",
                            )
                          )
                            action("withdraw");
                        }}
                      >
                        撤回发布
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
            {step === "history" && (
              <section className="authoring-card">
                <h2>历史版本</h2>
                <p>
                  恢复后先形成新草稿，不会立即影响学生。确认内容后再到“预览发布”。
                </p>
                {!history.length && <p>暂无修订历史。</p>}
                {history.map((r) => (
                  <details className="history-entry" key={r.id}>
                    <summary>
                      {r.body.title} · {r.created_at}{" "}
                      {r.is_published ? "（当前发布）" : ""}
                    </summary>
                    <ContentView content={r.body} preview />
                    <button
                      type="button"
                      disabled={busy || dirty}
                      onClick={() => {
                        if (confirm("将此版本恢复为新草稿？"))
                          action("restore", r.id);
                      }}
                    >
                      恢复为草稿
                    </button>
                  </details>
                ))}
                <details className="optional-fields">
                  <summary>复制或归档这个知识点</summary>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      editor.setBusy(true);
                      try {
                        const copy = await digitalApi.save({
                          ...form,
                          id: undefined,
                          edit_version: 0,
                          title: form.title + "（副本）",
                        });
                        navigate(`/teacher/knowledge/${copy.id}/settings`);
                      } catch (e) {
                        editor.setError((e as Error).message);
                      } finally {
                        editor.setBusy(false);
                      }
                    }}
                  >
                    复制为新的知识点
                  </button>
                  <p>归档只隐藏学生入口，保留历史和资料。</p>
                  <button
                    type="button"
                    className="danger"
                    disabled={busy || dirty}
                    onClick={() => {
                      if (confirm("确定归档并隐藏这个知识点？"))
                        action("archive");
                    }}
                  >
                    归档知识点
                  </button>
                </details>
              </section>
            )}
          </fieldset>
          <div className="authoring-bottom">
            <label className="check">
              <input
                type="checkbox"
                checked={editor.autosave}
                onChange={(e) => editor.setAutosave(e.target.checked)}
              />
              停笔后自动保存草稿
            </label>
            <div className="row-actions">
              {currentStep > 0 && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => go(editorSteps[currentStep - 1][0])}
                >
                  上一步
                </button>
              )}
              {currentStep < 3 && (
                <button
                  disabled={busy}
                  onClick={() => go(editorSteps[currentStep + 1][0])}
                >
                  {step === "settings"
                    ? "下一步：编写内容"
                    : step === "content"
                      ? "下一步：资料与关联"
                      : "下一步：预览发布"}{" "}
                  →
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </AuthoringPage>
  );
}
