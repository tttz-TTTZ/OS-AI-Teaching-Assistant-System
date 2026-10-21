import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, courseApi, documentApi, Material } from "../api";
import { digitalApi, Section } from "../digital";
import { useAuth } from "../auth";
import {
  Evidence,
  Mode,
  modeNames,
  PersonalConfig,
  PersonalJob,
  personalApi,
  PersonalSource,
  PersonalSummary,
} from "../personal";
import PersonalModule from "../learning/PersonalModule";
import Markdown from "../Markdown";
import { materialAccept, materialFileError } from "../materialFiles";

const studio: {
  mode: Mode | "practice";
  symbol: string;
  label: string;
  hint: string;
}[] = [
  {
    mode: "explain",
    symbol: "文",
    label: "知识讲解",
    hint: "结合资料解释概念",
  },
  { mode: "map", symbol: "图", label: "思维导图", hint: "整理知识结构与联系" },
  {
    mode: "flashcards",
    symbol: "卡",
    label: "知识闪卡",
    hint: "翻面回忆与复习",
  },
  { mode: "practice", symbol: "测", label: "测验", hint: "针对薄弱点自测" },
  {
    mode: "code",
    symbol: "码",
    label: "代码讲解",
    hint: "逐段理解代码或伪代码",
  },
  {
    mode: "summary",
    symbol: "纲",
    label: "复习总结",
    hint: "提炼重点与易错点",
  },
  { mode: "deep", symbol: "析", label: "深入分析", hint: "进一步解释原理" },
];

export default function LearningNotebook() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const jobId = Number(params.get("job"));
  const [chapters, setChapters] = useState<Chapter[]>([]),
    [sections, setSections] = useState<Section[]>([]);
  const [chapter, setChapter] = useState(Number(params.get("chapter")) || 0),
    [section, setSection] = useState(0);
  const [documents, setDocuments] = useState<Material[]>([]),
    [chosen, setChosen] = useState<Record<number, Material>>({}),
    [sources, setSources] = useState<PersonalSource[]>([]);
  const [category, setCategory] = useState("public"),
    [search, setSearch] = useState(""),
    [refresh, setRefresh] = useState(0),
    [docsLoading, setDocsLoading] = useState(false);
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
    daily_limit: number;
  }>();
  const [history, setHistory] = useState<PersonalSummary[]>([]),
    [job, setJob] = useState<PersonalJob>(),
    [parents, setParents] = useState<PersonalJob[]>([]);
  const [evidence, setEvidence] = useState<Evidence>(),
    [showEvidence, setShowEvidence] = useState(false);
  const [prompt, setPrompt] = useState(""),
    [level, setLevel] = useState("basic"),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [loading, setLoading] = useState(false);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState<number>();
  const [moduleIndex, setModuleIndex] = useState(0),
    [view, setView] = useState<"learn" | "notes">("learn");
  const [note, setNote] = useState(""),
    [bookmarked, setBookmarked] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true),
    [rightOpen, setRightOpen] = useState(true);
  const epoch = useRef(0),
    requestKey = useRef(""),
    fileInput = useRef<HTMLInputElement>(null),
    answerRef = useRef<HTMLDivElement>(null);
  const lastMode = useRef<Mode | "practice">("explain");
  const [generationStage, setGenerationStage] = useState("");
  const [useSources, setUseSources] = useState(true);
  const [pendingPilot, setPendingPilot] = useState<{
    mode: Mode;
    body: PersonalConfig;
    evidence: Evidence;
  }>();
  const pilotPoll = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  useEffect(() => () => clearInterval(pilotPoll.current), []);
  useEffect(() => {
    const saved = sessionStorage.getItem(`notebook-source-tab:${user?.id}`);
    if (saved === "personal" || saved === "public") setCategory(saved);
  }, [user?.id]);
  function sourceTab(value: string) {
    setCategory(value);
    sessionStorage.setItem(`notebook-source-tab:${user?.id}`, value);
  }
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    let alive = true;
    // Optional data failures must not disable all AI tools.
    Promise.allSettled([
      courseApi.chapters(),
      digitalApi.sections(),
      personalApi.status(),
      personalApi.jobs(),
    ]).then(([cs, ss, state, hs]) => {
      if (!alive) return;
      const failures: string[] = [];
      if (cs.status === "fulfilled") {
        setChapters(cs.value);
        setChapter((c) => c || cs.value[0]?.id || 0);
      } else failures.push("课程目录加载失败：" + cs.reason.message);
      if (ss.status === "fulfilled") setSections(ss.value);
      else failures.push("小节目录加载失败：" + ss.reason.message);
      if (state.status === "fulfilled") setStatus(state.value);
      else
        failures.push(
          "AI状态加载失败，点击工具时会重新检查：" + state.reason.message,
        );
      if (hs.status === "fulfilled") setHistory(hs.value);
      else failures.push("历史成果加载失败，不影响生成：" + hs.reason.message);
      if (failures.length) setError(failures.join("；"));
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    setDocsLoading(true);
    const timer = setTimeout(
      () =>
        documentApi
          .list(false, { category, q: search })
          .then((ds) => {
            if (!alive) return;
            setDocuments(ds);
            setChosen((old) => ({
              ...old,
              ...Object.fromEntries(ds.map((d) => [d.id, d])),
            }));
          })
          .catch((e) => {
            if (alive) setError(e.message);
          })
          .finally(() => {
            if (alive) setDocsLoading(false);
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [category, search, refresh]);
  useEffect(() => {
    let alive = true;
    epoch.current++;
    setError("");
    setEvidence(undefined);
    setShowEvidence(false);
    setPendingPilot(undefined);
    setJob(undefined);
    setParents([]);
    setLoading(!!jobId);
    setModuleIndex(0);
    setView("learn");
    if (!jobId) return;
    personalApi
      .job(jobId)
      .then(async (j) => {
        if (!alive) return;
        setJob(j);
        setChapter(j.chapter_id);
        setSection(j.config.section_id || 0);
        setSources(j.config.sources);
        setLevel(j.config.level);
        setUseSources(
          (j.config as PersonalConfig & { use_sources?: boolean })
            .use_sources !== false,
        );
        setNote(j.note);
        setBookmarked(!!j.bookmarked);
        setEvidence(j.sources);
        const followupKey = `notebook-followup:${user?.id}:${j.id}`;
        setPrompt(sessionStorage.getItem(followupKey) || "");
        sessionStorage.removeItem(followupKey);
        const prior: PersonalJob[] = [];
        let parent = j.body.answer ? null : j.config.parent_id;
        const visited = new Set<number>([j.id]);
        while (parent && prior.length < 5 && !visited.has(parent)) {
          visited.add(parent);
          const p = await personalApi.job(parent);
          if (!alive) return;
          prior.unshift(p);
          parent = p.config.parent_id;
        }
        if (alive) setParents(prior);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [jobId]);
  function invalidate() {
    setPendingPilot(undefined);
    requestKey.current = "";
    setEvidence(undefined);
    setError("");
  }
  function toggle(d: Material, checked: boolean) {
    if (checked && sources.length >= 5) {
      setError("每次最多选5份资料，可按本次主题分批学习。");
      return;
    }
    setChosen((old) => ({ ...old, [d.id]: d }));
    setSources((old) =>
      checked
        ? [...old, { document_id: d.id, start_page: 1, end_page: null }]
        : old.filter((s) => s.document_id !== d.id),
    );
    invalidate();
  }
  const config = (mode: Mode | "practice"): PersonalConfig => ({
    chapter_id: chapter,
    section_id: section || null,
    analysis_mode:
      mode === "map" || mode === "flashcards" ? "section" : "quick",
    sources,
    topic:
      mode === "map" || mode === "flashcards"
        ? prompt.trim() ||
          sections.find((s) => s.id === section)?.title ||
          chapters.find((c) => c.id === chapter)?.title ||
          "课程知识复习"
        : job?.config.topic ||
          prompt.trim() ||
          sources
            .map((source) => selectedTitle(source.document_id))
            .join("、")
            .slice(0, 1000),
    source_overview: !prompt.trim() && (job?.config.source_overview ?? !job),
    weakness: job ? prompt.trim() : "",
    level,
    kind: mode === "practice" ? "practice" : "learning",
    modes: [mode === "practice" ? "explain" : mode],
    question_kinds: ["single", "multiple", "boolean"],
    count: 5,
    parent_id: job?.status === "ready" ? job.id : null,
  });
  async function create(
    mode: Mode | "practice" = "explain",
    retry = false,
    confirmed = false,
  ) {
    if (busy || uploading || loading) return;
    if (noteDirty && !window.confirm("笔记尚未保存，确定先生成新内容吗？"))
      return;
    if (!chapter || !sources.length) {
      setError("请先在左侧选择课程和至少一份资料。");
      return;
    }
    const body = config(mode);
    if (
      confirmed &&
      JSON.stringify(body) !== JSON.stringify(pendingPilot?.body)
    ) {
      setError("范围或设置已改变，请重新点击工具预览。");
      setPendingPilot(undefined);
      return;
    }
    if (lastMode.current !== mode) requestKey.current = "";
    lastMode.current = mode;
    if (!body.topic) {
      setError("请先输入你想学习的主题。");
      return;
    }
    const token = epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    setView("learn");
    if (retry) requestKey.current = "";
    try {
      setGenerationStage("正在检查 AI 服务…");
      const state = await personalApi.status();
      if (token !== epoch.current) return;
      setStatus(state);
      if (!state.configured)
        throw new Error(
          "尚未配置 DeepSeek：请在后端 .env 设置 DEEPSEEK_API_KEY 并重启后端，密钥不要填在网页或聊天中。",
        );
      setGenerationStage("正在解析资料与检索依据…");
      const ev = await personalApi.preview(body);
      if (token !== epoch.current) return;
      setEvidence(ev);
      if (body.analysis_mode === "section") {
        if (
          !confirmed ||
          ev.fingerprint !== pendingPilot?.evidence.fingerprint
        ) {
          setPendingPilot({ mode: mode as Mode, body, evidence: ev });
          setMessage("已准备分析计划，确认后才调用模型；请检查小节页码范围。");
          return;
        }
        body.analysis_confirmed = true;
        setPendingPilot(undefined);
      }
      requestKey.current ||= crypto.randomUUID();
      if (body.analysis_mode === "section") {
        const key = requestKey.current;
        pilotPoll.current = setInterval(
          () =>
            personalApi
              .progress(key)
              .then((p) => {
                if (token === epoch.current)
                  setGenerationStage(
                    `${p.stage} · ${p.completed_batches}/${p.total_batches}批 · 本次已调用${p.calls_used}次`,
                  );
              })
              .catch(() => {}),
          2000,
        );
      }
      setGenerationStage(
        `正在生成${mode === "practice" ? "测验" : modeNames[mode]}，请稍候…`,
      );
      const result = await personalApi.generate(body, ev, requestKey.current);
      if (token !== epoch.current) return;
      if (result.status !== "ready")
        throw new Error(
          result.error ||
            "任务尚未完成，请先查看历史任务状态，再决定是否重新生成。",
        );
      requestKey.current = "";
      setHistory((old) => [
        { ...result, config_json: JSON.stringify(result.config) },
        ...old.filter((h) => h.id !== result.id),
      ]);
      setParams({ chapter: String(chapter), job: String(result.id) });
      setJob(result);
      setPrompt("");
      setTimeout(
        () => answerRef.current?.scrollTo({ top: 0, behavior: "smooth" }),
        0,
      );
    } catch (e) {
      if (token === epoch.current) {
        setError((e as Error).message);
        setHistory(await personalApi.jobs().catch(() => []));
      }
    } finally {
      clearInterval(pilotPoll.current);
      setBusy(false);
      setGenerationStage("");
    }
  }
  async function ask() {
    if (busy || uploading || loading) return;
    const question = prompt.trim();
    if (!question) {
      setError("请输入具体问题；需要导图、闪卡或测验时点击右侧工具。");
      return;
    }
    if (noteDirty && !window.confirm("笔记尚未保存，确定先提问吗？")) return;
    const token = epoch.current;
    setBusy(true);
    setError("");
    setMessage("");
    setView("learn");
    setPendingPilot(undefined);
    requestKey.current = "";
    setGenerationStage("正在回答你的问题…");
    try {
      const answer = await personalApi.ask(
        question,
        chapter,
        job?.status === "ready" ? job.id : null,
        sources,
        useSources,
        crypto.randomUUID(),
      );
      if (token !== epoch.current) return;
      if (answer.status !== "ready")
        throw new Error(answer.error || "问答任务尚未完成，请检查历史记录");
      setHistory((old) => [
        { ...answer, config_json: JSON.stringify(answer.config) },
        ...old.filter((h) => h.id !== answer.id),
      ]);
      setParams({ chapter: String(answer.chapter_id), job: String(answer.id) });
      setJob(answer);
      setPrompt("");
    } catch (e) {
      if (token === epoch.current) setError((e as Error).message);
    } finally {
      setBusy(false);
      setGenerationStage("");
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    const failure = materialFileError(file);
    if (failure) {
      setError(failure);
      return;
    }
    setUploading(true);
    setError("");
    setProgress(0);
    try {
      const d = await courseApi.upload(
        file,
        chapter ? String(chapter) : "",
        setProgress,
      );
      setChosen((old) => ({ ...old, [d.id]: d }));
      sourceTab("personal");
      setSearch("");
      setRefresh((v) => v + 1);
      if (sources.length < 5) {
        setSources((old) =>
          old.some((s) => s.document_id === d.id)
            ? old
            : [...old, { document_id: d.id, start_page: 1, end_page: null }],
        );
      }
      setMessage("资料已保存到本人账号，其他学生不可读取。");
      invalidate();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      setProgress(undefined);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function open(id: number) {
    if (job?.id === id) {
      setView("learn");
      return;
    }
    if (noteDirty && !window.confirm("笔记未保存，确定先离开吗？")) return;
    setParams({ chapter: String(chapter), job: String(id) });
    setMessage("");
  }
  function newTopic() {
    if (noteDirty && !window.confirm("笔记未保存，确定新建话题吗？")) return;
    epoch.current++;
    setParams({ chapter: String(chapter) });
    setJob(undefined);
    setParents([]);
    setPrompt("");
    setNote("");
    setView("learn");
    invalidate();
  }
  const noteDirty =
    !!job && (note !== job.note || bookmarked !== !!job.bookmarked);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (noteDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [noteDirty]);
  async function saveNote() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      const saved = await personalApi.note(job, note, bookmarked);
      setJob(saved);
      setMessage("个人笔记与收藏已保存");
      setHistory(await personalApi.jobs());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const visibleDocs = documents.filter(
    (d) => category === "personal" || !d.chapter_id || d.chapter_id === chapter,
  );
  const current = job?.body.modules?.[moduleIndex];
  const selectedTitle = (id: number) =>
    chosen[id]?.title ||
    job?.sources.chunks.find((c) => c.document_id === id)?.title ||
    `资料 #${id}`;
  return (
    <div className="learning-notebook">
      <header className="notebook-topbar">
        <h1>操作系统 · 智能问答</h1>
        <Link className="notebook-return" to="/student/dashboard">
          ← 返回首页
        </Link>
      </header>
      <div className="notebook-panel-switches">
        <button
          className="secondary"
          aria-expanded={leftOpen}
          onClick={() => setLeftOpen(!leftOpen)}
        >
          {leftOpen ? "收起来源" : "展开来源"}
        </button>
        <button
          className="secondary"
          aria-expanded={rightOpen}
          onClick={() => setRightOpen(!rightOpen)}
        >
          {rightOpen ? "收起学习工具" : "展开学习工具"}
        </button>
      </div>
      <div
        className={`notebook-grid ${leftOpen ? "" : "sources-collapsed"} ${rightOpen ? "" : "studio-collapsed"}`}
      >
        {leftOpen && (
          <section
            className="notebook-pane notebook-sources"
            aria-label="学习来源"
          >
            <div className="notebook-pane-title">
              <h2>来源</h2>
              <span>{sources.length}/5 已选</span>
            </div>
            <label className="notebook-label">
              课程章节
              <select
                aria-label="笔记本课程章节"
                value={chapter}
                disabled={busy}
                onChange={(e) => {
                  setChapter(Number(e.target.value));
                  setSection(0);
                  setSources([]);
                  setParams({ chapter: e.target.value });
                  invalidate();
                }}
              >
                {!chapters.length && (
                  <option value={0}>等待教师发布课程</option>
                )}
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <select
              aria-label="笔记本课程小节"
              value={section}
              disabled={busy}
              onChange={(e) => {
                setSection(Number(e.target.value));
                invalidate();
              }}
            >
              <option value={0}>全部小节 / 自选主题</option>
              {sections
                .filter((s) => s.chapter_id === chapter)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.title}
                  </option>
                ))}
            </select>
            <input
              ref={fileInput}
              type="file"
              accept={materialAccept}
              aria-label="上传我的学习来源"
              className="notebook-file"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <button
              className="notebook-add-source"
              disabled={uploading || busy}
              onClick={() => fileInput.current?.click()}
            >
              {uploading ? `上传中 ${progress ?? 0}%` : "＋ 上传个人资料"}
            </button>
            <div className="notebook-source-tabs">
              <button
                className={category === "public" ? "selected" : ""}
                onClick={() => sourceTab("public")}
              >
                公共资料
              </button>
              <button
                className={category === "personal" ? "selected" : ""}
                onClick={() => sourceTab("personal")}
              >
                我的上传
              </button>
            </div>
            <input
              aria-label="查找笔记本来源"
              placeholder="查找资料标题"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="notebook-source-list">
              {docsLoading ? (
                <p>正在读取来源…</p>
              ) : visibleDocs.length ? (
                visibleDocs.map((d) => (
                  <label className="notebook-source-row" key={d.id}>
                    <span
                      className={`source-file-icon file-${d.file_type || "txt"}`}
                    >
                      {(d.file_type || "TXT").toUpperCase()}
                    </span>
                    <span title={d.title}>{d.title}</span>
                    <input
                      aria-label={`选择来源：${d.title}`}
                      type="checkbox"
                      checked={sources.some((s) => s.document_id === d.id)}
                      disabled={
                        busy ||
                        (sources.length >= 5 &&
                          !sources.some((s) => s.document_id === d.id))
                      }
                      onChange={(e) => toggle(d, e.target.checked)}
                    />
                  </label>
                ))
              ) : (
                <p className="notebook-empty-small">
                  {category === "public"
                    ? "本章暂无匹配的公共资料，请等待教师发布，或选择其他章节。"
                    : "还没有匹配的个人资料，可以直接上传。"}
                </p>
              )}
            </div>
            {!!sources.length && (
              <details className="notebook-source-ranges">
                <summary>已选来源与页码范围</summary>
                {sources.map((s) => (
                  <div key={s.document_id}>
                    <strong>{selectedTitle(s.document_id)}</strong>
                    <label>
                      从第几页
                      <input
                        aria-label={`来源${s.document_id}起始页`}
                        type="number"
                        min={1}
                        max={600}
                        value={s.start_page}
                        disabled={busy}
                        onChange={(e) => {
                          setSources((old) =>
                            old.map((x) =>
                              x.document_id === s.document_id
                                ? { ...x, start_page: Number(e.target.value) }
                                : x,
                            ),
                          );
                          invalidate();
                        }}
                      />
                    </label>
                    <label>
                      结束页（留空为整份）
                      <input
                        aria-label={`来源${s.document_id}结束页`}
                        type="number"
                        min={1}
                        max={600}
                        value={s.end_page || ""}
                        disabled={busy}
                        onChange={(e) => {
                          setSources((old) =>
                            old.map((x) =>
                              x.document_id === s.document_id
                                ? {
                                    ...x,
                                    end_page: Number(e.target.value) || null,
                                  }
                                : x,
                            ),
                          );
                          invalidate();
                        }}
                      />
                    </label>
                    <button
                      className="notebook-text-button"
                      disabled={busy}
                      onClick={() => {
                        setSources((old) =>
                          old.filter((x) => x.document_id !== s.document_id),
                        );
                        invalidate();
                      }}
                    >
                      移除来源
                    </button>
                  </div>
                ))}
              </details>
            )}
            <details className="notebook-settings">
              <summary>学习设置</summary>
              <label>
                讲解深度
                <select
                  aria-label="笔记本讲解深度"
                  value={level}
                  onChange={(e) => {
                    setLevel(e.target.value);
                    invalidate();
                  }}
                >
                  <option value="basic">基础入门</option>
                  <option value="intermediate">理解与应用</option>
                  <option value="advanced">深入分析</option>
                </select>
              </label>
              <p>
                公共资料由教师发布，个人上传仅本人可见。支持文字PPT/PPTX、PDF、TXT；图片文字暂需OCR。
              </p>
            </details>
          </section>
        )}
        <section
          className="notebook-pane notebook-conversation"
          aria-label="学习对话"
        >
          <div className="notebook-pane-title">
            <h2>{view === "notes" ? "我的学习笔记" : "学习与问答"}</h2>
            <button className="secondary" onClick={newTopic} disabled={busy}>
              ＋ 新话题
            </button>
          </div>
          <div className="notebook-answer" ref={answerRef} aria-live="polite">
            {busy && (
              <p role="status" className="notebook-success">
                {generationStage}
              </p>
            )}
            {pendingPilot?.evidence.pilot_plan && (
              <section className="pilot-plan" aria-label="小节提炼确认">
                <h3>确认完整提炼范围</h3>
                <p>
                  小节：{pendingPilot.evidence.pilot_plan.scope}。
                  {pendingPilot.evidence.pilot_plan.selected_pages}页，
                  {pendingPilot.evidence.pilot_plan.text_chunks}个正文块，分
                  {pendingPilot.evidence.pilot_plan.batches}批；可复用
                  {pendingPilot.evidence.pilot_plan.cached_batches}批。
                </p>
                <p>
                  预计最多{pendingPilot.evidence.pilot_plan.estimated_calls}
                  次模型调用，可能计费。目录标记
                  {pendingPilot.evidence.pilot_plan.excluded.length}块，无文字页
                  {pendingPilot.evidence.pilot_plan.unreadable_pages.length}
                  页；不代表已识别图片或已校对知识。
                </p>
                <button
                  disabled={busy}
                  onClick={() => create(pendingPilot.mode, false, true)}
                >
                  确认开始小节提炼
                </button>
                <button
                  className="secondary"
                  onClick={() => setPendingPilot(undefined)}
                >
                  返回调整范围
                </button>
              </section>
            )}

            {error && (
              <p role="alert" className="notice">
                {error}
              </p>
            )}
            {message && (
              <p role="status" className="notebook-success">
                {message}
              </p>
            )}
            {loading ? (
              <p>正在恢复学习内容…</p>
            ) : view === "notes" && job ? (
              <div className="notebook-notes">
                <h3>{job.body.title} · 个人笔记</h3>
                <textarea
                  aria-label="笔记本个人笔记"
                  disabled={busy}
                  rows={14}
                  maxLength={20000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <label className="check">
                  <input
                    type="checkbox"
                    checked={bookmarked}
                    onChange={(e) => setBookmarked(e.target.checked)}
                  />
                  收藏这份学习内容
                </label>
                <button disabled={busy || !noteDirty} onClick={saveNote}>
                  保存笔记与收藏
                </button>
              </div>
            ) : job ? (
              <>
                {!!parents.length && (
                  <details className="notebook-thread-history">
                    <summary>
                      继续之前的学习（{parents.length}条上下文）
                    </summary>
                    {parents.map((p) => (
                      <button
                        key={p.id}
                        className="notebook-history-button"
                        onClick={() => open(p.id)}
                      >
                        {p.body.title || p.config.topic}
                      </button>
                    ))}
                  </details>
                )}
                {!job.body.answer && (
                  <div className="notebook-user-message">
                    {job.config.weakness || job.config.topic}
                  </div>
                )}
                <p className="notebook-answer-meta">
                  AI辅助学习 · 仅本人可见 · {job.model} ·{" "}
                  {job.status === "ready"
                    ? "已保存"
                    : job.status === "failed"
                      ? "生成失败"
                      : job.status === "running"
                        ? "生成中"
                        : "已中断"}
                </p>
                {job.error && <p role="alert">{job.error}</p>}
                {job.status === "running" && (
                  <button
                    onClick={() =>
                      personalApi
                        .job(job.id)
                        .then(setJob)
                        .catch((e) => setError(e.message))
                    }
                  >
                    刷新任务状态
                  </button>
                )}
                {job.body.answer ? (
                  <section aria-label="直接问答记录">
                    <p className="notebook-answer-meta">
                      {job.body.basis === "general"
                        ? "通用知识解释 · 未引用所选课件"
                        : "结合本次检索到的资料回答"}{" "}
                      · 保留最近对话上下文
                    </p>
                    {job.sources.warnings.map((w, i) => (
                      <p key={i} className="notebook-answer-meta">
                        {w}
                      </p>
                    ))}
                    {(job.body.conversation || []).map((turn, i) => (
                      <article
                        key={i}
                        className={`notebook-chat-turn ${turn.role}`}
                      >
                        <strong>
                          {turn.role === "user" ? "我" : "AI 助教"}
                        </strong>
                        <Markdown content={turn.content} />
                      </article>
                    ))}
                    {!!job.body.citations?.length && (
                      <details>
                        <summary>本次回答的资料依据</summary>
                        {job.body.citations.map((c, i) => (
                          <blockquote key={i}>{c.source_quote}</blockquote>
                        ))}
                      </details>
                    )}
                  </section>
                ) : job.kind === "practice" ? (
                  <div>
                    <h3>{job.body.title}</h3>
                    <p>
                      已生成{job.body.questions?.length || 0}
                      道个人自测，独立保存，不计入教师成绩。
                    </p>
                    <Link
                      className="button"
                      to={`/student/ai-practice?job=${job.id}`}
                    >
                      开始作答 / 查看解析
                    </Link>
                  </div>
                ) : (
                  current && (
                    <>
                      <div
                        className="notebook-module-tabs"
                        aria-label="当前学习成果"
                      >
                        {job.body.modules?.map((m, i) => (
                          <button
                            key={i}
                            className={i === moduleIndex ? "selected" : ""}
                            onClick={() => setModuleIndex(i)}
                          >
                            {modeNames[m.mode]}
                          </button>
                        ))}
                      </div>
                      {current.mode === "map" && !job.body.pilot && (
                        <p className="notice">
                          这是旧版抽样导图。点击右侧“思维导图”可按当前所选正文重新提炼，旧记录不会被覆盖。
                        </p>
                      )}
                      <PersonalModule
                        key={`${job.id}-${moduleIndex}`}
                        module={current}
                        job={job.id}
                        index={moduleIndex}
                        analysis={job.body.pilot}
                        evidence={job.sources}
                      />
                      <div className="notebook-citation">
                        <button
                          className="notebook-text-button"
                          onClick={() => setShowEvidence(!showEvidence)}
                        >
                          查看资料依据
                        </button>
                        <blockquote>{current.source_quote}</blockquote>
                      </div>
                    </>
                  )
                )}
                {job.status === "ready" && (
                  <div className="notebook-response-actions">
                    <button
                      className="secondary"
                      onClick={() => setView("notes")}
                    >
                      保存到个人笔记
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        setPrompt("请换一种更通俗的方式解释，并举一个例子。")
                      }
                    >
                      换个例子
                    </button>
                    <button
                      className="secondary"
                      onClick={() =>
                        setPrompt(
                          "我仍然分不清这些概念，请针对我的薄弱点再分析。",
                        )
                      }
                    >
                      继续分析薄弱点
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="notebook-welcome">
                <div className="notebook-welcome-mark">OS</div>
                <h2>从你的课程资料，开始一次自主学习</h2>
                <p>
                  左侧选择公共资料或个人上传；在这里提问，或从右侧制作导图、闪卡、测验和学习总结。
                </p>
                <div className="notebook-prompt-examples">
                  {[
                    "帮我梳理这一章的知识结构",
                    "用生活中的例子解释核心概念",
                    "分析课件代码的执行过程",
                  ].map((text) => (
                    <button
                      className="secondary"
                      key={text}
                      onClick={() => setPrompt(text)}
                    >
                      {text}
                    </button>
                  ))}
                </div>
                <p>
                  教师负责资料与目录；学习内容由你选择。教学视频、音频不在本次范围。
                </p>
              </div>
            )}
            {showEvidence && evidence && (
              <section className="notebook-evidence">
                <h3>本次检索依据</h3>
                <p>
                  从{evidence.indexed_chunks}个片段中检索，发送
                  {evidence.characters}字。
                </p>
                {evidence.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                {evidence.chunks.map((c) => (
                  <details key={c.ref}>
                    <summary>
                      {c.title} · 第{c.page}页
                    </summary>
                    <pre className="source-excerpt">{c.text}</pre>
                  </details>
                ))}
              </section>
            )}
          </div>
          <div className="notebook-composer">
            <label className="sr-only" htmlFor="notebook-prompt">
              提问或创作学习内容
            </label>
            <label className="notebook-chat-settings">
              <input
                type="checkbox"
                checked={useSources}
                disabled={busy}
                onChange={(e) => setUseSources(e.target.checked)}
              />
              结合已选资料；不选资料也可直接提问
            </label>
            <textarea
              id="notebook-prompt"
              aria-label="提问或创作学习内容"
              rows={2}
              maxLength={1000}
              placeholder={
                job
                  ? "继续提问，或描述你的薄弱点…"
                  : "直接输入具体问题，例如：为什么虚拟机能运行不同操作系统？"
              }
              value={prompt}
              disabled={busy}
              onChange={(e) => {
                setPrompt(e.target.value);
                requestKey.current = "";
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  ask();
                }
              }}
            />
            <div>
              <span>
                {sources.length}个来源 ·{" "}
                {busy ? generationStage : "Ctrl / ⌘ + Enter 发送"}
              </span>
              <button
                aria-label="发送学习问题"
                disabled={busy || uploading || loading}
                onClick={ask}
              >
                {busy ? "生成中…" : "发送 ↑"}
              </button>
            </div>
            {!status?.configured && (
              <small>
                尚未检测到已配置的
                DeepSeek。点击工具可重新检查并查看具体原因；来源管理仍可使用。
              </small>
            )}
            {error && requestKey.current && (
              <button
                className="notebook-text-button"
                disabled={busy}
                onClick={() => create(lastMode.current, true)}
              >
                确认历史任务后重新生成（可能计费）
              </button>
            )}
          </div>
        </section>
        {rightOpen && (
          <section
            className="notebook-pane notebook-studio"
            aria-label="学习工具"
          >
            <div className="notebook-pane-title">
              <h2>学习工具</h2>
              <span>Studio</span>
            </div>
            <p className="notebook-studio-hint">
              先勾选左侧资料。无需填写主题即可概览所选资料；填写具体问题时按问题检索。生成后自动保存在本人账号。
            </p>
            <p className="notebook-studio-hint">
              导图和闪卡默认先提炼知识，生成前确认范围与调用次数；可选具体小节，也可整理本章多个相关课件。最多120页、12批，超限先调整页码。
            </p>
            <div className="notebook-tools">
              {studio.map((tool) => (
                <button
                  key={tool.mode}
                  className={`notebook-tool tool-${tool.mode}`}
                  title={tool.hint}
                  disabled={busy || uploading || loading}
                  onClick={() => create(tool.mode)}
                >
                  <span aria-hidden="true">{tool.symbol}</span>
                  <strong>{tool.label}</strong>
                </button>
              ))}
            </div>
            <p className="notebook-cost">
              AI调用可能计费，每日最多{status?.daily_limit || 20}
              个任务；导图和闪卡按确认计划可能包含多次调用，不自动重试。
            </p>
            <div className="notebook-pane-title notebook-results-title">
              <h3>我的学习成果</h3>
              <span>{history.length}</span>
            </div>
            <div className="notebook-artifacts">
              {!history.length && <p>导图、闪卡和学习记录会出现在这里。</p>}
              {history.map((h) => {
                let title = "学习内容",
                  modes: Mode[] = [],
                  isChat = false;
                try {
                  const c = JSON.parse(h.config_json);
                  title = c.topic;
                  modes = c.modes || [];
                  isChat = !!c.chat;
                } catch {}
                return (
                  <button
                    className={`notebook-artifact ${h.id === jobId ? "selected" : ""}`}
                    key={h.id}
                    disabled={busy}
                    onClick={() => open(h.id)}
                  >
                    <span className="artifact-symbol">
                      {isChat
                        ? "问"
                        : h.kind === "practice"
                          ? "测"
                          : modes[0] === "flashcards"
                            ? "卡"
                            : modes[0] === "map"
                              ? "图"
                              : "文"}
                    </span>
                    <span>
                      <strong>{title}</strong>
                      <small>
                        {isChat
                          ? "直接问答"
                          : h.kind === "practice"
                            ? "个人自测"
                            : modes
                                .map((m) => modeNames[m] || m)
                                .join(" / ")}{" "}
                        ·{" "}
                        {h.status === "ready"
                          ? "已保存"
                          : h.status === "failed"
                            ? "失败"
                            : "处理中"}
                        {h.bookmarked ? " · 已收藏" : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="notebook-studio-footer">
              <button
                className="secondary"
                disabled={!job || job.status !== "ready"}
                onClick={() => setView("notes")}
              >
                ＋ 个人笔记
              </button>
              <Link to="/student/ai-practice">全部个人练习</Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
