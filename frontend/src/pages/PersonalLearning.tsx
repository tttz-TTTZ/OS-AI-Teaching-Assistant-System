import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, courseApi, documentApi, Material } from "../api";
import { digitalApi, Section } from "../digital";
import { useAuth } from "../auth";
import { Notice } from "../components";
import {
  Evidence,
  Mode,
  modeNames,
  PersonalConfig,
  PersonalGrade,
  PersonalJob,
  personalApi,
  PersonalSummary,
} from "../personal";
import PersonalModule from "../learning/PersonalModule";
import Markdown from "../Markdown";

export default function PersonalLearning({
  practice = false,
}: {
  practice?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const jobId = Number(params.get("job"));
  const { user } = useAuth();
  const [chapters, setChapters] = useState<Chapter[]>([]),
    [sections, setSections] = useState<Section[]>([]),
    [docs, setDocs] = useState<Material[]>([]);
  const [category, setCategory] = useState("public"),
    [q, setQ] = useState("");
  const [config, setConfig] = useState<PersonalConfig>({
    chapter_id: Number(params.get("chapter")) || 0,
    section_id: null,
    sources: [],
    topic: "",
    weakness: "",
    level: "basic",
    kind: practice ? "practice" : "learning",
    modes: ["explain"],
    question_kinds: ["single"],
    count: 5,
    parent_id: null,
  });
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
    daily_limit: number;
  }>();
  const [evidence, setEvidence] = useState<Evidence>(),
    [job, setJob] = useState<PersonalJob>(),
    [history, setHistory] = useState<PersonalSummary[]>([]);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0),
    [note, setNote] = useState(""),
    [bookmarked, setBookmarked] = useState(false),
    [followup, setFollowup] = useState("");
  const [answers, setAnswers] = useState<Record<number, unknown>>({}),
    [grade, setGrade] = useState<PersonalGrade>(),
    [attempts, setAttempts] = useState<PersonalGrade[]>([]);
  const key = useRef(""),
    submitKey = useRef(crypto.randomUUID()),
    sequence = useRef(0);
  useEffect(() => {
    let alive = true;
    Promise.all([
      courseApi.chapters(),
      digitalApi.sections(),
      personalApi.status(),
      personalApi.jobs(),
    ])
      .then(([cs, ss, state, hs]) => {
        if (!alive) return;
        setChapters(cs);
        setSections(ss);
        setStatus(state);
        setHistory(hs);
        setConfig((c) => ({
          ...c,
          chapter_id: c.chapter_id || cs[0]?.id || 0,
        }));
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(
      () =>
        documentApi
          .list(false, { category, q })
          .then((rows) => {
            if (alive) setDocs(rows);
          })
          .catch((e) => {
            if (alive) setError(e.message);
          }),
      250,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [category, q]);
  useEffect(() => {
    let alive = true;
    sequence.current++;
    setError("");
    setJob(undefined);
    setGrade(undefined);
    setAttempts([]);
    setActive(0);
    if (!jobId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    personalApi
      .job(jobId)
      .then(async (j) => {
        if (!alive) return;
        setJob(j);
        setNote(j.note);
        setBookmarked(!!j.bookmarked);
        setFollowup("");
        if (j.kind === "practice" && j.status === "ready") {
          setAttempts(await personalApi.attempts(j.id));
          try {
            setAnswers(
              JSON.parse(
                sessionStorage.getItem(
                  `personal-answers:${user?.id}:${j.id}`,
                ) || "{}",
              ),
            );
          } catch {
            setAnswers({});
          }
          submitKey.current = crypto.randomUUID();
        }
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
  }, [jobId, user?.id]);
  function change(update: Partial<PersonalConfig>) {
    setConfig((c) => ({ ...c, ...update }));
    setEvidence(undefined);
    key.current = "";
    setError("");
  }
  async function generate(retry = false) {
    const seq = sequence.current;
    setBusy(true);
    setError("");
    setMessage("");
    if (retry) key.current = "";
    try {
      const ev = evidence || (await personalApi.preview(config));
      if (seq !== sequence.current) return;
      setEvidence(ev);
      key.current ||= crypto.randomUUID();
      const j = await personalApi.generate(config, ev, key.current);
      if (seq !== sequence.current) return;
      setParams({ job: String(j.id) });
      setHistory(await personalApi.jobs());
    } catch (e) {
      if (seq === sequence.current) {
        setError((e as Error).message);
        setHistory(await personalApi.jobs().catch(() => []));
      }
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    setBusy(true);
    setError("");
    try {
      setEvidence(await personalApi.preview(config));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function newLearning() {
    sequence.current++;
    setParams({});
    setEvidence(undefined);
    key.current = "";
    setMessage("");
  }
  function continueWith(kind: "learning" | "practice") {
    if (!job) return;
    setConfig({
      ...job.config,
      kind,
      parent_id: job.id,
      weakness: followup || job.config.weakness,
    });
    setEvidence(undefined);
    key.current = "";
    setParams({});
    setMessage(
      "已带入原资料与学习上下文，请选择方式并确认生成；不会覆盖上一份内容。",
    );
    window.scrollTo(0, 0);
  }
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
  function choose(index: number, answer: unknown) {
    const next = { ...answers, [index]: answer };
    setAnswers(next);
    if (job)
      sessionStorage.setItem(
        `personal-answers:${user?.id}:${job.id}`,
        JSON.stringify(next),
      );
  }
  function answerText(index: number, value: unknown) {
    const question = job?.body.questions?.[index];
    if (!question || question.kind === "short")
      return String(value ?? "未作答");
    const selected = Array.isArray(value) ? value : [value];
    return selected
      .map((v, i) =>
        question.kind === "matching"
          ? `${question.items[i]} → ${question.options[Number(v)] || "未选择"}`
          : question.options[Number(v)] || "未选择",
      )
      .join("；");
  }
  async function submit() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      setGrade(await personalApi.submit(job.id, answers, submitKey.current));
      setAttempts(await personalApi.attempts(job.id));
      sessionStorage.removeItem(`personal-answers:${user?.id}:${job.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const kind = job?.kind || config.kind;
  return (
    <div className="authoring-page personal-workspace">
      <header className="authoring-heading">
        <h1>
          {(job?.kind || config.kind) === "practice"
            ? "我的 AI 练习"
            : "我的自主学习"}
        </h1>
        <p>
          教师提供课程目录和公共资料，你选择学习内容与方式。AI内容仅属于本人，不作为教师正式教材或正式成绩。
        </p>
      </header>
      <div className="authoring-toolbar">
        <Link
          className={practice ? "button secondary" : "button"}
          to="/student/knowledge"
        >
          自主学习
        </Link>
        <Link className="button secondary" to="/student/practice">
          教师正式练习
        </Link>
        <Link
          className={practice ? "button" : "button secondary"}
          to="/student/ai-practice"
        >
          我的 AI 练习
        </Link>
        <Link to="/student/course-reading">历史课程内容</Link>
        {jobId > 0 && (
          <button disabled={busy} onClick={newLearning}>
            新建个人学习 / 自测
          </button>
        )}
      </div>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
      {loading ? (
        <p>正在读取个人内容…</p>
      ) : !jobId ? (
        <>
          <section className="authoring-card authoring-form">
            <h2>1 选择课程范围与资料</h2>
            <p>
              每章小节数量由教师设定；无需等待教师编写教案。课件支持文字PPT/PPTX、PDF、TXT，图片文字暂需OCR。
            </p>
            <fieldset disabled={busy}>
              <label>
                课程大章
                <select
                  aria-label="课程大章"
                  value={config.chapter_id}
                  onChange={(e) =>
                    change({
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
                课程小节
                <select
                  aria-label="课程小节"
                  value={config.section_id || 0}
                  onChange={(e) =>
                    change({ section_id: Number(e.target.value) || null })
                  }
                >
                  <option value={0}>自行确定本章主题</option>
                  {sections
                    .filter((s) => s.chapter_id === config.chapter_id)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} {s.title}
                      </option>
                    ))}
                </select>
              </label>
              <div className="row-actions">
                <button
                  className={category === "public" ? "" : "secondary"}
                  onClick={() => setCategory("public")}
                >
                  教师公共资料
                </button>
                <button
                  className={category === "personal" ? "" : "secondary"}
                  onClick={() => setCategory("personal")}
                >
                  我的个人资料
                </button>
                <Link to="/student/materials">上传或查看资料 →</Link>
              </div>
              <label>
                查找学习资料
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="输入资料标题"
                />
              </label>
              <div className="lesson-source-list">
                {docs.map((d) => (
                  <label className="lesson-source-option" key={d.id}>
                    <input
                      type="checkbox"
                      checked={config.sources.some(
                        (s) => s.document_id === d.id,
                      )}
                      disabled={
                        config.sources.length >= 5 &&
                        !config.sources.some((s) => s.document_id === d.id)
                      }
                      onChange={(e) =>
                        change({
                          sources: e.target.checked
                            ? [
                                ...config.sources,
                                {
                                  document_id: d.id,
                                  start_page: 1,
                                  end_page: null,
                                },
                              ]
                            : config.sources.filter(
                                (s) => s.document_id !== d.id,
                              ),
                        })
                      }
                    />
                    <span>
                      {d.title} · {d.file_type || "文字"}
                      {d.chapter_id === config.chapter_id
                        ? " · 当前章节"
                        : d.chapter_id
                          ? " · 其他章节资料"
                          : " · 全课程资料"}
                    </span>
                  </label>
                ))}
                {!docs.length && (
                  <p>
                    暂无可用资料，请调整查找条件、上传本人资料或等待教师发布。
                  </p>
                )}
              </div>
              {config.sources.map((s) => (
                <div className="row-actions" key={s.document_id}>
                  <span>资料 #{s.document_id}</span>
                  <label>
                    起始页
                    <input
                      aria-label={`资料${s.document_id}起始页`}
                      type="number"
                      min={1}
                      max={600}
                      value={s.start_page}
                      onChange={(e) =>
                        change({
                          sources: config.sources.map((x) =>
                            x.document_id === s.document_id
                              ? { ...x, start_page: Number(e.target.value) }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    结束页（留空检索整份）
                    <input
                      aria-label={`资料${s.document_id}结束页`}
                      type="number"
                      min={1}
                      max={600}
                      value={s.end_page || ""}
                      onChange={(e) =>
                        change({
                          sources: config.sources.map((x) =>
                            x.document_id === s.document_id
                              ? {
                                  ...x,
                                  end_page: Number(e.target.value) || null,
                                }
                              : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="secondary"
                    onClick={() =>
                      change({
                        sources: config.sources.filter(
                          (x) => x.document_id !== s.document_id,
                        ),
                      })
                    }
                  >
                    移除此资料
                  </button>
                </div>
              ))}
            </fieldset>
          </section>
          <section className="authoring-card authoring-form">
            <h2>2 告诉 AI 你想学什么</h2>
            <fieldset disabled={busy}>
              <label>
                学习主题
                <input
                  maxLength={1000}
                  value={config.topic}
                  onChange={(e) => change({ topic: e.target.value })}
                  placeholder="例如：进程与线程的区别、FCFS的等待时间"
                />
              </label>
              <label>
                我的薄弱点或追问
                <textarea
                  rows={5}
                  maxLength={2000}
                  value={config.weakness}
                  onChange={(e) => change({ weakness: e.target.value })}
                  placeholder="例如：概念能背，但不会判断资源共享；请给我对比和具体场景。"
                />
              </label>
              <label>
                讲解深度
                <select
                  aria-label="讲解深度"
                  value={config.level}
                  onChange={(e) => change({ level: e.target.value })}
                >
                  <option value="basic">基础入门</option>
                  <option value="intermediate">理解与应用</option>
                  <option value="advanced">深入分析</option>
                </select>
              </label>
              <label>
                本次生成
                <select
                  aria-label="本次生成"
                  value={config.kind}
                  onChange={(e) =>
                    change({ kind: e.target.value as "learning" | "practice" })
                  }
                >
                  <option value="learning">个人学习内容</option>
                  <option value="practice">针对薄弱点的个人自测</option>
                </select>
              </label>
              {config.kind === "learning" ? (
                <>
                  <p>学习方式可以多选，全部都可选；若内容较大可分批生成。</p>
                  <div className="personal-options">
                    {Object.entries(modeNames).map(([m, label]) => (
                      <label className="check" key={m}>
                        <input
                          type="checkbox"
                          checked={config.modes.includes(m as Mode)}
                          onChange={(e) =>
                            change({
                              modes: e.target.checked
                                ? [...config.modes, m as Mode]
                                : config.modes.filter((x) => x !== m),
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      change({ modes: Object.keys(modeNames) as Mode[] })
                    }
                  >
                    选择全部学习方式
                  </button>
                </>
              ) : (
                <>
                  <p>
                    个人AI练习与教师题库分开保存，不写入正式成绩。简答仅给参考答案。
                  </p>
                  <label>
                    题目数量
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={config.count}
                      onChange={(e) =>
                        change({ count: Number(e.target.value) })
                      }
                    />
                  </label>
                  <div className="personal-options">
                    {[
                      ["single", "单选"],
                      ["multiple", "多选"],
                      ["boolean", "判断"],
                      ["short", "简答"],
                      ["matching", "匹配"],
                    ].map(([v, n]) => (
                      <label className="check" key={v}>
                        <input
                          type="checkbox"
                          checked={config.question_kinds.includes(v)}
                          onChange={(e) =>
                            change({
                              question_kinds: e.target.checked
                                ? [...config.question_kinds, v]
                                : config.question_kinds.filter((k) => k !== v),
                            })
                          }
                        />
                        {n}
                      </label>
                    ))}
                  </div>
                </>
              )}
              <p>
                按主题从所选课件检索最多24000字发送至DeepSeek；最多5份、每份600页以内。密钥仅保存在后端。生成可能计费，个人每日上限
                {status?.daily_limit || 20}次，不自动重试。
                {!status?.configured &&
                  "当前未配置DeepSeek，仍可检索资料依据。"}
              </p>
              <div className="row-actions">
                <button
                  className="secondary"
                  disabled={!config.topic.trim() || !config.sources.length}
                  onClick={preview}
                >
                  查看检索依据
                </button>
                <button
                  disabled={
                    !status?.configured ||
                    !config.chapter_id ||
                    !config.topic.trim() ||
                    !config.sources.length ||
                    (config.kind === "learning"
                      ? !config.modes.length
                      : !config.question_kinds.length ||
                        config.count < 1 ||
                        config.count > 10)
                  }
                  onClick={() => generate()}
                >
                  {busy ? "正在处理，请等待…" : "开始生成我的内容"}
                </button>
              </div>
              {error && key.current && (
                <button
                  className="secondary"
                  disabled={!status?.configured}
                  onClick={() => generate(true)}
                >
                  核对记录后，重新生成（可能计费）
                </button>
              )}
            </fieldset>
          </section>
          {evidence && (
            <section className="authoring-card">
              <h2>检索到的学习依据</h2>
              <p>
                从{evidence.indexed_chunks}个文字片段中检索，实际发送
                {evidence.characters}字。{evidence.method}
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
        </>
      ) : (
        job && (
          <>
            <section className="authoring-card">
              <span className="badge">
                仅本人可见 · AI{kind === "practice" ? "自测" : "学习内容"}
              </span>
              <h2>{job.body.title || job.config.topic}</h2>
              <p>
                {job.model} · {job.created_at} ·{" "}
                {(
                  {
                    ready: "已保存",
                    running: "生成中",
                    failed: "生成失败",
                    interrupted: "已中断",
                  } as Record<string, string>
                )[job.status] || job.status}
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
              <p>
                学习主题：{job.config.topic}；自述薄弱点：
                {job.config.weakness || "未填写"}
              </p>
            </section>
            {job.status === "ready" && job.kind === "learning" && (
              <>
                <nav className="personal-options" aria-label="我的学习方式">
                  {job.body.modules?.map((m, i) => (
                    <button
                      className={active === i ? "" : "secondary"}
                      key={i}
                      onClick={() => setActive(i)}
                    >
                      {modeNames[m.mode]}
                    </button>
                  ))}
                </nav>
                {job.body.modules?.[active] && (
                  <section className="authoring-card">
                    <PersonalModule
                      key={`${job.id}-${active}`}
                      module={job.body.modules[active]}
                      job={job.id}
                      index={active}
                    />
                  </section>
                )}
              </>
            )}
            {job.status === "ready" && job.kind === "practice" && (
              <section className="authoring-card authoring-form">
                <h2>个人自测 · 不计入教师正式成绩</h2>
                {job.body.questions?.length !== job.body.requested_count && (
                  <p>
                    资料仅支持生成{job.body.questions?.length}
                    题，少于请求数量，请先核对题目。
                  </p>
                )}
                {job.body.questions?.map((question, i) => (
                  <fieldset
                    className="authoring-card"
                    key={i}
                    disabled={busy || !!grade}
                  >
                    <legend>
                      {i + 1}. {question.prompt}
                    </legend>
                    {question.kind === "short" ? (
                      <textarea
                        rows={5}
                        maxLength={5000}
                        value={String(answers[i] || "")}
                        onChange={(e) => choose(i, e.target.value)}
                      />
                    ) : question.kind === "matching" ? (
                      question.items.map((item, j) => (
                        <label key={j}>
                          {item}
                          <select
                            value={
                              (answers[i] as number[] | undefined)?.[j] ?? -1
                            }
                            onChange={(e) => {
                              const next = [
                                ...((answers[i] as number[]) ||
                                  Array(question.items.length).fill(-1)),
                              ];
                              next[j] = Number(e.target.value);
                              choose(i, next);
                            }}
                          >
                            <option value={-1}>请选择</option>
                            {question.options.map((o, k) => (
                              <option key={k} value={k}>
                                {o}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))
                    ) : (
                      question.options.map((o, j) => (
                        <label className="check" key={j}>
                          <input
                            type={
                              question.kind === "multiple"
                                ? "checkbox"
                                : "radio"
                            }
                            name={`personal-${i}`}
                            checked={
                              question.kind === "multiple"
                                ? ((answers[i] as number[]) || []).includes(j)
                                : answers[i] === j
                            }
                            onChange={(e) =>
                              choose(
                                i,
                                question.kind === "multiple"
                                  ? e.target.checked
                                    ? [...((answers[i] as number[]) || []), j]
                                    : ((answers[i] as number[]) || []).filter(
                                        (x) => x !== j,
                                      )
                                  : j,
                              )
                            }
                          />
                          {o}
                        </label>
                      ))
                    )}
                  </fieldset>
                ))}
                {!grade && (
                  <button disabled={busy} onClick={submit}>
                    提交我的自测
                  </button>
                )}
                {grade && (
                  <>
                    <p role="status">
                      个人自测：{grade.score} / {grade.total}；{grade.ungraded}
                      题需自行对照参考答案
                    </p>
                    {grade.results.map((r) => (
                      <section key={r.index}>
                        <h3>
                          {r.index + 1}.{" "}
                          {r.correct === null
                            ? "请对照参考"
                            : r.correct
                              ? "回答正确"
                              : "需要巩固"}
                        </h3>
                        <p>你的回答：{answerText(r.index, r.selected)}</p>
                        <p>参考答案：{answerText(r.index, r.answer)}</p>
                        <Markdown content={r.explanation} />
                      </section>
                    ))}
                    <button
                      className="secondary"
                      onClick={() => {
                        setGrade(undefined);
                        setAnswers({});
                        submitKey.current = crypto.randomUUID();
                      }}
                    >
                      重新自测
                    </button>
                  </>
                )}
                <details>
                  <summary>本题组作答记录（{attempts.length}次）</summary>
                  {attempts.map((a, i) => (
                    <p key={i}>
                      第{attempts.length - i}次：{a.score}/{a.total}，未自动评分
                      {a.ungraded}题
                      <button
                        className="secondary"
                        onClick={() => {
                          setGrade(a);
                          setAnswers(
                            Object.fromEntries(
                              a.results.map((r) => [r.index, r.selected]),
                            ),
                          );
                        }}
                      >
                        查看本次解析
                      </button>
                    </p>
                  ))}
                </details>
              </section>
            )}
            {job.status === "ready" && (
              <>
                <section className="authoring-card authoring-form">
                  <h2>继续解决我的疑问</h2>
                  <label>
                    我还不理解的地方
                    <textarea
                      rows={4}
                      maxLength={2000}
                      value={followup}
                      onChange={(e) => setFollowup(e.target.value)}
                      placeholder="例如：我还是不理解第2题，换一个例子，并针对这个错误再给我出题。"
                    />
                  </label>
                  <div className="row-actions">
                    <button
                      disabled={busy}
                      onClick={() => continueWith("learning")}
                    >
                      带着疑问继续学习
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => continueWith("practice")}
                    >
                      针对薄弱点再生成自测
                    </button>
                    <Link to="/student/experiments">进入算法实验</Link>
                  </div>
                  <p>
                    下一步可重新选择学习方式；新结果另存一份，保留本次记录。
                  </p>
                </section>
                <section className="authoring-card authoring-form">
                  <h2>我的笔记与收藏</h2>
                  <label>
                    个人笔记
                    <textarea
                      aria-label="个人笔记"
                      rows={6}
                      maxLength={20000}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={bookmarked}
                      onChange={(e) => setBookmarked(e.target.checked)}
                    />
                    收藏本次学习内容
                  </label>
                  <button disabled={busy} onClick={saveNote}>
                    保存个人笔记
                  </button>
                </section>
              </>
            )}
            <details className="authoring-card">
              <summary>本次资料依据与引用</summary>
              {job.sources.warnings.map((w, i) => (
                <p key={i}>{w}</p>
              ))}
              {job.sources.chunks.map((c) => (
                <details key={c.ref}>
                  <summary>
                    {c.title} · 第{c.page}页
                  </summary>
                  <pre className="source-excerpt">{c.text}</pre>
                </details>
              ))}
              {job.body.modules?.map((m, i) => (
                <blockquote key={i}>
                  {m.title}：{m.source_quote}
                </blockquote>
              ))}
            </details>
          </>
        )
      )}
      <section className="authoring-card">
        <h2>我的学习与自测记录</h2>
        {!history.length && <p>还没有个人生成记录，从课程资料开始即可。</p>}
        {history.map((h) => {
          let title = "个人内容";
          try {
            title = JSON.parse(h.config_json).topic;
          } catch {}
          return (
            <div className="outline-point" key={h.id}>
              <span>
                {h.bookmarked ? "★ " : ""}
                {h.kind === "practice" ? "自测" : "学习"} · {title} ·{" "}
                {h.created_at}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setParams({ job: String(h.id) });
                  window.scrollTo(0, 0);
                }}
              >
                打开记录
              </button>
            </div>
          );
        })}
      </section>
    </div>
  );
}
