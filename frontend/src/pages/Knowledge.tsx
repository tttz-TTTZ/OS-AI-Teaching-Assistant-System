import { MouseEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { fileUrl } from "../api";
import { Content, digitalApi, Progress, Section } from "../digital";
import { Notice, useChapters } from "../components";
import { useAuth } from "../auth";
import ContentView from "../learning/ContentView";
import { studyApi } from "../study";
import { Experiment, experimentApi } from "../experiments";

type View = "read" | "resources" | "notes";
const views: [View, string][] = [
  ["read", "阅读与观察"],
  ["resources", "相关资料"],
  ["notes", "笔记与反馈"],
];

export default function Knowledge() {
  const { chapters, error } = useChapters();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const chapter = Number(params.get("chapter")) || chapters[0]?.id;
  const requested = Number(params.get("point"));
  const view: View = views.some(([key]) => key === params.get("view"))
    ? (params.get("view") as View)
    : "read";
  const [items, setItems] = useState<Content[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [detail, setDetail] = useState<Content>();
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [hasPractice, setHasPractice] = useState<boolean | null>(null);
  useEffect(() => {
    let current = true;
    setHasPractice(null);
    if (requested && chapter)
      studyApi
        .questions(chapter, requested)
        .then((rows) => {
          if (current) setHasPractice(rows.length > 0);
        })
        .catch(() => {
          if (current) setHasPractice(false);
        });
    return () => {
      current = false;
    };
  }, [requested, chapter]);
  useEffect(() => {
    let active = true;
    setExperiments([]);
    if (requested)
      experimentApi
        .list(requested)
        .then((rows) => {
          if (active) setExperiments(rows);
        })
        .catch((e) => {
          if (active) setFailure(e.message);
        });
    return () => {
      active = false;
    };
  }, [requested]);
  const [progress, setProgress] = useState<Progress>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [font, setFont] = useState(17);
  const [feedback, setFeedback] = useState("");
  const generation = useRef(0);
  const loadedContext = useRef("");
  const noteKey = `os:learning-draft:${user?.id}:${requested}`;

  useEffect(() => {
    let active = true;
    generation.current += 1;
    loadedContext.current = "";
    setDetail(undefined);
    setProgress(undefined);
    setItems([]);
    setSections([]);
    setDirty(false);
    setFailure("");
    setMessage("");
    setFeedback("");
    setSaving(false);
    if (!chapter && !requested) return;
    setLoading(true);
    async function load() {
      // A link from materials or practice can supply only the knowledge point ID.
      const d = requested ? await digitalApi.detail(requested) : undefined;
      if (!active) return;
      if (d && (!params.get("chapter") || d.chapter_id !== chapter)) {
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("chapter", String(d.chapter_id));
            return next;
          },
          { replace: true },
        );
      }
      const [list, secs] = await Promise.all([
        digitalApi.list(d?.chapter_id || chapter!),
        digitalApi.sections(d?.chapter_id || chapter!),
      ]);
      if (!active) return;
      setItems(list);
      setSections(secs);
      if (!d) return;
      const saved = await digitalApi.progress(requested);
      if (!active) return;
      loadedContext.current = noteKey;
      setDetail(d);
      setProgress(saved);
      let resumePosition = saved.position;
      try {
        sessionStorage.setItem(
          `os:last:${user?.id}`,
          JSON.stringify({
            chapter: d.chapter_id,
            point: d.id,
            title: d.title,
          }),
        );
        const local = JSON.parse(
          sessionStorage.getItem(noteKey) || "null",
        ) as Progress | null;
        if (local && local.revision_id === saved.revision_id) {
          setProgress({
            ...saved,
            position: d.blocks.some((b) => b.id === local.position)
              ? local.position
              : saved.position,
            note: local.note,
            read_done: local.read_done,
            self_assessed: local.self_assessed,
            bookmarked: local.bookmarked,
            version: local.version,
          });
          if (d.blocks.some((b) => b.id === local.position))
            resumePosition = local.position;
          setDirty(true);
          setMessage("已恢复本标签未保存的学习记录，请检查后保存");
          if (local.version !== saved.version)
            setFailure(
              "学习记录已在其他页面更新；本地笔记已保留，请复制后重新载入，避免覆盖。",
            );
        } else if (local) {
          setFailure(
            "教材已有新版，旧版未保存笔记已放入“笔记与反馈”，请核对后再保存到新版。",
          );
          // Keep the user's text accessible even when the published revision changes.
          setProgress({ ...saved, note: local.note });
          setDirty(true);
        }
      } catch {
        /* Storage restrictions do not prevent reading the course. */
      }
      const anchor = params.get("block");
      if (
        !anchor &&
        resumePosition &&
        d.blocks.some((b) => b.id === resumePosition)
      ) {
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.set("block", resumePosition);
            return next;
          },
          { replace: true },
        );
      }
    }
    load()
      .catch((e) => {
        if (active) setFailure(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [chapter, requested, user?.id]);

  useEffect(() => {
    if (dirty && progress && loadedContext.current === noteKey) {
      try {
        sessionStorage.setItem(noteKey, JSON.stringify(progress));
      } catch {
        setMessage("浏览器无法暂存，请点击保存学习记录，勿直接关闭页面。");
      }
    }
  }, [dirty, progress, noteKey]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty || feedback.trim()) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, feedback]);

  async function save() {
    if (!detail?.id || !progress || saving || loadedContext.current !== noteKey)
      return false;
    const token = generation.current;
    setSaving(true);
    setMessage("保存中…");
    setFailure("");
    try {
      const result = await digitalApi.saveProgress(detail.id, progress);
      if (token !== generation.current) return false;
      setProgress((p) => (p ? { ...p, version: result.version } : p));
      setDirty(false);
      try {
        sessionStorage.removeItem(noteKey);
      } catch {
        /* 数据库保存已成功。 */
      }
      setMessage("学习记录已保存");
      return true;
    } catch (e) {
      if (token === generation.current) {
        setMessage("尚未同步，请保留笔记后重试");
        setFailure((e as Error).message);
      }
      return false;
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }
  async function reloadRecord() {
    if (
      saving ||
      !detail?.id ||
      (dirty &&
        !confirm(
          "重新读取会放弃本页未保存的记录，请先复制需要保留的笔记。确定继续？",
        ))
    )
      return;
    const token = generation.current;
    setSaving(true);
    setFailure("");
    try {
      const saved = await digitalApi.progress(detail.id);
      if (token !== generation.current) return;
      setProgress(saved);
      setDirty(false);
      setMessage("已重新读取保存的学习记录");
      try {
        sessionStorage.removeItem(noteKey);
      } catch {
        /* 不影响数据库读取。 */
      }
    } catch (e) {
      if (token === generation.current) setFailure((e as Error).message);
    } finally {
      if (token === generation.current) setSaving(false);
    }
  }
  function changeProgress(patch: Partial<Progress>) {
    setProgress((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
    setMessage("");
  }
  async function leaveTo(next: URLSearchParams) {
    if (
      saving ||
      (feedback.trim() && !confirm("尚未发送的反馈将被清空，确定离开？")) ||
      (dirty && !(await save()))
    )
      return;
    setParams(next);
    window.scrollTo(0, 0);
  }
  function choose(point: Content) {
    void leaveTo(
      new URLSearchParams({
        chapter: String(point.chapter_id),
        point: String(point.id),
        block: "overview",
      }),
    );
  }
  function selectView(next: View) {
    if (saving) return;
    setParams((current) => {
      const p = new URLSearchParams(current);
      p.set("view", next);
      return p;
    });
    window.scrollTo(0, 0);
  }
  function selectBlock(id: string) {
    if (saving) return;
    setParams((current) => {
      const p = new URLSearchParams(current);
      p.set("view", "read");
      p.set("block", id);
      return p;
    });
    if (id !== "overview") changeProgress({ position: id });
    window.scrollTo(0, 0);
  }
  async function follow(e: MouseEvent<HTMLAnchorElement>, to: string) {
    e.preventDefault();
    if (
      saving ||
      (feedback.trim() && !confirm("尚未发送的反馈将被清空，确定离开？")) ||
      (dirty && !(await save()))
    )
      return;
    navigate(to);
    window.scrollTo(0, 0);
  }
  async function refreshCompletion() {
    const token = generation.current;
    try {
      const remote = await digitalApi.progress(requested);
      if (token === generation.current)
        setProgress((p) =>
          p
            ? {
                ...p,
                completed_blocks: remote.completed_blocks,
                practice_completed: remote.practice_completed,
              }
            : remote,
        );
    } catch (e) {
      if (token === generation.current) setFailure((e as Error).message);
    }
  }
  const currentChapter = chapters.find((c) => c.id === chapter);
  const currentSection = sections.find((s) => s.id === detail?.section_id);
  const modules = [
    { id: "overview", title: "开始学习", kind: "overview" },
    ...(detail?.blocks.map((b) => ({
      id: b.id,
      title: b.title || "学习内容",
      kind: b.kind,
    })) || []),
  ];
  // Derive the first rendered module from the loaded record too, so navigation
  // never briefly points to the overview while the URL is being canonicalized.
  const selectedBlock = params.get("block") || progress?.position || "overview";
  const active = modules.some((b) => b.id === selectedBlock)
    ? selectedBlock
    : "overview";
  const moduleIndex = modules.findIndex((b) => b.id === active);
  const index = items.findIndex((p) => p.id === detail?.id);
  const visible = items.filter((p) =>
    (p.code + " " + p.title + " " + p.summary).includes(query),
  );
  const stageNames: Record<string, string> = {
    overview: "学习路线",
    intro: "想一想",
    concept: "抓住概念",
    explanation: "理解原理",
    diagram: "看图梳理",
    interaction: "动手观察",
    case: "看个例子",
    mistake: "辨清误区",
    summary: "回顾要点",
  };
  const stageHints: Record<string, string> = {
    intro: "先带着这个问题往下读，不必急着给出标准答案。",
    concept: "先抓住定义和边界，再进入具体过程。",
    explanation: "留意成立条件，理解每一步为什么发生。",
    diagram: "选择节点查看关系，或逐条阅读分支。",
    interaction: "先预测，再操作；对照状态变化检查自己的判断。",
    case: "把刚才的原理放回具体情景中理解。",
    mistake: "对照容易混淆的说法，找出差异。",
    summary: "试着用自己的话解释，再决定是否做实验或练习。",
  };
  const practice = `/student/practice?chapter=${chapter || ""}&knowledge=${detail?.id || ""}&block=${active === "overview" ? "" : encodeURIComponent(active)}`;
  const catalog = new URLSearchParams(
    chapter ? { chapter: String(chapter) } : {},
  );
  function pointRows(section: number | null) {
    return visible
      .filter((p) => p.section_id === section)
      .map((p) => (
        <div className="study-point-row" key={p.id}>
          <div>
            <small>
              {/^CH0[12]-/.test(p.code || "")
                ? p.emphasis || "知识点"
                : p.code || "知识点"}
              {p.minutes ? ` · 建议 ${p.minutes} 分钟` : ""}
            </small>
            <h3>{p.title}</h3>
            <div className="reading-card-tags">
              {p.block_kinds?.includes("diagram") && <span>有图解</span>}
              {p.block_kinds?.includes("interaction") && (
                <span>可交互观察</span>
              )}
              {p.lab && <span>配套实验</span>}
            </div>
            {p.summary && <p>{p.summary}</p>}
          </div>
          <button onClick={() => choose(p)} disabled={saving}>
            开始学习 →
          </button>
        </div>
      ));
  }

  function experimentLinks() {
    return experiments.map((experiment) => {
      const to = `/student/experiments/${experiment.id}?from=${detail?.id}&block=${encodeURIComponent(active)}`;
      return (
        <p key={experiment.id}>
          <Link
            className="textlink"
            to={to}
            onClick={(e) => void follow(e, to)}
          >
            {experiment.title} · 进入完整实验 →
          </Link>
        </p>
      );
    });
  }
  return (
    <div className="study-workspace">
      {!requested ? (
        <>
          <header className="study-heading">
            <span>KNOWLEDGE / 课程学习</span>
            <h1>选择今天要学的知识点</h1>
            <p>先选章节，再进入知识点。阅读、动画和练习在学习页按顺序展开。</p>
          </header>
          <Notice error={error || failure} />
          <section className="study-card study-catalog-controls">
            <label>
              课程章节
              <select
                aria-label="课程章节"
                value={chapter || ""}
                onChange={(e) => {
                  setQuery("");
                  void leaveTo(
                    new URLSearchParams({ chapter: e.target.value }),
                  );
                }}
              >
                {!chapters.length && <option value="">暂无已发布章节</option>}
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              查找本章知识点
              <input
                aria-label="搜索本章知识点"
                placeholder="输入标题、编号或关键词"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </section>
          <section className="study-card study-catalog" aria-busy={loading}>
            <h2>{currentChapter?.title || "课程目录"}</h2>
            {currentChapter?.description && <p>{currentChapter.description}</p>}
            {loading ? (
              <p role="status">正在加载目录…</p>
            ) : (
              <>
                {sections
                  .filter((s) => visible.some((p) => p.section_id === s.id))
                  .map((s) => (
                    <section className="study-section" key={s.id}>
                      <h3>
                        {s.code} {s.title}
                      </h3>
                      {pointRows(s.id)}
                    </section>
                  ))}
                {pointRows(null)}
                {!visible.length && (
                  <p>
                    {query
                      ? "没有找到匹配的知识点，请换个关键词。"
                      : "本章暂无已发布知识点，请稍后再来。"}
                  </p>
                )}
              </>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="study-breadcrumb">
            <button
              className="text-button"
              disabled={saving}
              onClick={() => void leaveTo(catalog)}
            >
              ← 返回课程目录
            </button>
            <span>
              {currentChapter?.title}
              {currentSection ? ` / ${currentSection.title}` : ""}
            </span>
          </div>
          <Notice error={error || failure} />
          {loading ? (
            <div className="study-card" role="status">
              正在加载教材…
            </div>
          ) : detail ? (
            <>
              <header className="study-heading study-lesson-heading">
                <span>
                  {/^CH0[12]-/.test(detail.code || "")
                    ? "知识学习"
                    : detail.code || "知识学习"}
                </span>
                <h1>{detail.title}</h1>
              </header>
              <nav className="study-tabs" aria-label="知识点学习任务">
                {views.map(([key, label]) => (
                  <button
                    key={key}
                    aria-current={view === key ? "page" : undefined}
                    className={view === key ? "selected" : ""}
                    onClick={() => selectView(key)}
                    disabled={saving}
                  >
                    {label}
                  </button>
                ))}
                <Link
                  className="study-practice-link"
                  to={practice}
                  onClick={(e) => void follow(e, practice)}
                >
                  练习与自测 →
                </Link>
                <Link
                  className="study-practice-link"
                  to={`/student/ai-chat?chapter=${chapter}&topic=${encodeURIComponent("我正在学习「" + detail.title + "」，请帮我解释其中的难点。我想具体问：")}`}
                  onClick={(e) =>
                    void follow(
                      e,
                      `/student/ai-chat?chapter=${chapter}&topic=${encodeURIComponent("我正在学习「" + detail.title + "」，请帮我解释其中的难点。我想具体问：")}`,
                    )
                  }
                >
                  向AI问这个概念 →
                </Link>
              </nav>
              {message && (
                <p role="status" className="study-status">
                  {message}
                </p>
              )}
              {progress?.has_previous_version && (
                <p className="notice">
                  内容已更新。旧版学习记录保留，阅读本版后可重新标记。
                </p>
              )}
              <div hidden={view !== "read"}>
                <nav className="reading-route" aria-label="学习路线">
                  {modules.map((m, i) => (
                    <button
                      key={m.id}
                      disabled={saving}
                      aria-current={active === m.id ? "step" : undefined}
                      onClick={() => selectBlock(m.id)}
                    >
                      <span>{i === 0 ? "起" : i}</span>
                      {stageNames[m.kind] || m.title}
                    </button>
                  ))}
                </nav>
                <section className="study-card study-module-tools">
                  <label>
                    本知识点学习导航
                    <select
                      aria-label="本知识点学习导航"
                      value={active}
                      disabled={saving}
                      onChange={(e) => selectBlock(e.target.value)}
                    >
                      {modules.map((b, i) => (
                        <option key={b.id} value={b.id}>
                          {i === 0 ? "开始学习" : `${i}. ${b.title}`}
                          {b.kind === "interaction" ? " · 交互动画" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span>
                    {moduleIndex === 0
                      ? "选择学习起点"
                      : `阅读位置 ${moduleIndex} / ${modules.length - 1}`}
                  </span>
                  <label className="study-font">
                    字号
                    <select
                      aria-label="阅读字号"
                      value={font}
                      onChange={(e) => setFont(Number(e.target.value))}
                    >
                      {[15, 17, 19, 21].map((n) => (
                        <option key={n} value={n}>
                          {n}px
                        </option>
                      ))}
                    </select>
                  </label>
                </section>
                <section
                  className="study-card study-reader"
                  style={{ fontSize: font }}
                  aria-label="当前学习内容"
                >
                  {active !== "overview" && (
                    <header className="reading-stage-heading">
                      <span>
                        第 {moduleIndex} 步 ·{" "}
                        {stageNames[modules[moduleIndex].kind] || "继续学习"}
                      </span>
                      <p>
                        {stageHints[modules[moduleIndex].kind] ||
                          "按自己的节奏阅读，可以随时切换环节。"}
                      </p>
                    </header>
                  )}
                  <ContentView
                    key={`${detail.id}-${detail.revision_id}-${active}`}
                    content={detail}
                    focus={active}
                    active={view === "read"}
                    onComplete={refreshCompletion}
                  />
                  {active === "overview" && (
                    <>
                      <p>
                        按顺序学习，或直接选择你想弄懂的环节。阅读位置会自动记在本次学习记录中。
                      </p>
                      {modules.length > 1 && (
                        <button
                          className="reading-start"
                          onClick={() => selectBlock(modules[1].id)}
                        >
                          开始这一知识点 →
                        </button>
                      )}
                      <ol className="study-module-list">
                        {modules.slice(1).map((b) => (
                          <li key={b.id}>
                            <button
                              className="text-button"
                              onClick={() => selectBlock(b.id)}
                            >
                              {b.title}
                              {b.kind === "interaction" ? " · 交互动画" : ""}
                            </button>
                          </li>
                        ))}
                      </ol>
                      {!!experiments.length && (
                        <section className="learning-objectives">
                          <h3>配套算法实验</h3>
                          <p>
                            先读内容，再用完整实验修改输入、运行并记录观察。
                          </p>
                          {experimentLinks()}
                        </section>
                      )}
                      {!detail.blocks.length && (
                        <p>本知识点暂无正文模块，可先查看相关资料。</p>
                      )}
                    </>
                  )}
                  {active !== "overview" &&
                    ["diagram", "case", "summary"].includes(
                      modules[moduleIndex].kind,
                    ) &&
                    !!experiments.length && (
                      <section className="reading-lab-prompt">
                        <h3>把理解放进实验里</h3>
                        <p>
                          先预测结果，再调整参数验证；完成后可返回这里继续。
                        </p>
                        {experimentLinks()}
                      </section>
                    )}
                </section>
                <div className="study-next-bar">
                  <button
                    className="secondary"
                    disabled={saving || moduleIndex === 0}
                    onClick={() => selectBlock(modules[moduleIndex - 1].id)}
                  >
                    上一环节
                  </button>
                  <span>{modules[moduleIndex].title}</span>
                  {moduleIndex < modules.length - 1 ? (
                    <button
                      disabled={saving}
                      onClick={() => selectBlock(modules[moduleIndex + 1].id)}
                    >
                      下一环节 →
                    </button>
                  ) : experiments.length ? (
                    <Link
                      className="button"
                      to={`/student/experiments/${experiments[0].id}?from=${detail.id}&block=${encodeURIComponent(active)}`}
                      onClick={(e) =>
                        void follow(
                          e,
                          `/student/experiments/${experiments[0].id}?from=${detail.id}&block=${encodeURIComponent(active)}`,
                        )
                      }
                    >
                      进入配套实验 →
                    </Link>
                  ) : hasPractice === false ? (
                    <button onClick={() => selectView("notes")}>
                      记下我的理解 →
                    </button>
                  ) : (
                    <Link
                      className="button"
                      to={practice}
                      onClick={(e) => void follow(e, practice)}
                    >
                      读完了，去练习 →
                    </Link>
                  )}
                </div>
                <details className="study-card study-more">
                  <summary>学完之后</summary>
                  <div className="study-after">
                    <button
                      className="secondary"
                      onClick={() => selectView("notes")}
                    >
                      写笔记 / 标记阅读
                    </button>
                    {detail.lab && (
                      <Link
                        to="/student/experiments"
                        onClick={(e) => void follow(e, "/student/experiments")}
                      >
                        浏览算法实验 →
                      </Link>
                    )}
                    {index >= 0 && index < items.length - 1 && (
                      <button onClick={() => choose(items[index + 1])}>
                        下一个知识点 →
                      </button>
                    )}
                    {index > 0 && (
                      <button
                        className="secondary"
                        onClick={() => choose(items[index - 1])}
                      >
                        上一个知识点
                      </button>
                    )}
                  </div>
                </details>
              </div>
              {view === "resources" && (
                <>
                  <section className="study-card">
                    <h2>本知识点相关资料</h2>
                    <p>需要补充阅读时再打开，资料不会挤占正文空间。</p>
                    {detail.materials?.map((m) => {
                      const to = `/student/materials?document=${m.id}`;
                      return (
                        <div className="study-resource" key={m.id}>
                          <Link to={to} onClick={(e) => void follow(e, to)}>
                            {m.title} →
                          </Link>
                          {m.file_type && (
                            <a
                              href={fileUrl(m.id)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              新窗口打开文件 ↗
                            </a>
                          )}
                        </div>
                      );
                    })}
                    {!detail.materials?.length && <p>教师尚未关联补充资料。</p>}
                  </section>
                  <section className="study-card">
                    <h2>关联学习</h2>
                    {detail.related?.map((p) => {
                      const to = `/student/knowledge?chapter=${p.chapter_id}&point=${p.id}`;
                      return (
                        <p key={p.id}>
                          <Link to={to} onClick={(e) => void follow(e, to)}>
                            {p.title} →
                          </Link>
                        </p>
                      );
                    })}
                    {!detail.related?.length && <p>暂无关联知识点</p>}
                    {!!experiments.length && (
                      <>
                        <h3>配套算法实验</h3>
                        {experimentLinks()}
                      </>
                    )}
                    {detail.lab && !experiments.length && (
                      <p>
                        <Link
                          to="/student/experiments"
                          onClick={(e) =>
                            void follow(e, "/student/experiments")
                          }
                        >
                          浏览算法实验 →
                        </Link>
                      </p>
                    )}
                    <Link
                      to={`/student/practice?chapter=${chapter}`}
                      onClick={(e) =>
                        void follow(e, `/student/practice?chapter=${chapter}`)
                      }
                    >
                      进入章节练习 →
                    </Link>
                  </section>
                </>
              )}
              {view === "notes" && (
                <>
                  <section className="study-card study-notes">
                    <h2>我的学习记录</h2>
                    <p>已阅读与自评由你确认，浏览页面不会自动标记掌握。</p>
                    {progress && (
                      <fieldset disabled={saving}>
                        <div className="study-record-options">
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!progress.read_done}
                              onChange={(e) =>
                                changeProgress({ read_done: e.target.checked })
                              }
                            />
                            标记已阅读
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!progress.self_assessed}
                              onChange={(e) =>
                                changeProgress({
                                  self_assessed: e.target.checked,
                                })
                              }
                            />
                            我认为已经掌握（自评）
                          </label>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={!!progress.bookmarked}
                              onChange={(e) =>
                                changeProgress({ bookmarked: e.target.checked })
                              }
                            />
                            收藏本知识点
                          </label>
                        </div>
                        <div className="study-record-summary">
                          <span>
                            互动：
                            {detail.blocks.some((b) => b.kind === "interaction")
                              ? `${progress.completed_blocks?.length || 0} 项已完成观察`
                              : "不适用"}
                          </span>
                          <span>
                            练习：
                            {progress.practice_completed
                              ? "已完成作答"
                              : "尚未记录作答"}
                          </span>
                        </div>
                        <label>
                          私人学习笔记
                          <textarea
                            aria-label="私人学习笔记"
                            maxLength={5000}
                            placeholder="写下你的理解、疑问和易错点，仅本人可见。"
                            value={progress.note}
                            onChange={(e) =>
                              changeProgress({ note: e.target.value })
                            }
                          />
                        </label>
                        <div className="study-note-actions">
                          <button disabled={saving} onClick={() => void save()}>
                            保存学习记录
                          </button>
                          <button
                            className="secondary"
                            onClick={() => void reloadRecord()}
                          >
                            重新读取记录
                          </button>
                          <small>
                            {dirty ? "有未保存修改" : "当前无待保存修改"} ·
                            笔记仅本人可见
                          </small>
                        </div>
                      </fieldset>
                    )}
                  </section>
                  <section className="study-card study-feedback">
                    <h2>向教师提问或反馈</h2>
                    <p>此处主动发送给教师；私人学习笔记不会发送。</p>
                    <details>
                      <summary>给教师反馈本知识点</summary>
                      <label>
                        主动提交的学习反馈
                        <textarea
                          aria-label="主动提交的学习反馈"
                          maxLength={2000}
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                      </label>
                      <button
                        disabled={saving || !feedback.trim()}
                        onClick={async () => {
                          const token = generation.current;
                          setSaving(true);
                          setFailure("");
                          try {
                            await studyApi.feedback(detail.id!, feedback);
                            if (token === generation.current) {
                              setFeedback("");
                              setMessage("反馈已发送给教师");
                            }
                          } catch (e) {
                            if (token === generation.current)
                              setFailure((e as Error).message);
                          } finally {
                            if (token === generation.current) setSaving(false);
                          }
                        }}
                      >
                        发送学习反馈
                      </button>
                    </details>
                  </section>
                </>
              )}
            </>
          ) : (
            <section className="study-card">
              <h1>暂时无法打开这个知识点</h1>
              <p>内容可能尚未发布或已被撤回，请返回课程目录选择其他内容。</p>
              <button onClick={() => void leaveTo(catalog)}>
                返回课程目录
              </button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
