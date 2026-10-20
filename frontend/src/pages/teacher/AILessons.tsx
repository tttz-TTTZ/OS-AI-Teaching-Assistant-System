import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, teacherApi } from "../../api";
import { digitalApi, Section } from "../../digital";
import {
  aiQuestionApi,
  AIJobSummary,
  SourcePick,
  SourcePreview,
} from "../../aiQuestions";
import {
  aiLessonApi,
  LessonJob,
  LessonPlan,
  lessonKinds,
} from "../../aiLessons";
import { Notice } from "../../components";
import { AuthoringPage } from "./Authoring";
import LessonSources from "./LessonSources";

export default function AILessons() {
  const [params, setParams] = useSearchParams();
  const step = params.get("step") || "sources";
  const jobId = Number(params.get("job"));
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [chapter, setChapter] = useState(0);
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
  }>();
  const [jobs, setJobs] = useState<AIJobSummary[]>([]);
  const [job, setJob] = useState<LessonJob>();
  const [plan, setPlan] = useState<LessonPlan>();
  const [sources, setSources] = useState<SourcePick[]>([]);
  const [preview, setPreview] = useState<SourcePreview>();
  const [maxPoints, setMaxPoints] = useState(4);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [editing, setEditing] = useState<[number, number] | null>(null);
  const requestKey = useRef("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    Promise.all([
      teacherApi.chapters(),
      digitalApi.sections(),
      aiQuestionApi.status(),
      aiLessonApi.jobs(),
    ])
      .then(([cs, ss, state, js]) => {
        if (mounted.current) {
          setChapters(cs);
          setSections(ss);
          setChapter(cs[0]?.id || 0);
          setStatus(state);
          setJobs(js);
        }
      })
      .catch((e) => {
        if (mounted.current) setError(e.message);
      });
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    setError("");
    setJob(undefined);
    setPlan(undefined);
    setEditing(null);
    setDirty(false);
    setReviewed(false);
    aiLessonApi
      .job(jobId)
      .then((j) => {
        if (active) {
          setJob(j);
          if (j.status === "ready" || j.status === "imported") setPlan(j.plan);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [jobId]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  function go(next: string, id?: number) {
    if (dirty && !window.confirm("候选修改尚未保存，确定放弃本页修改吗？"))
      return;
    if (dirty && job) setPlan(job.plan);
    setDirty(false);
    setEditing(null);
    setError("");
    if (next === "sources") {
      setPreview(undefined);
      requestKey.current = "";
    }
    setParams({ step: next, ...(id ? { job: String(id) } : {}) });
    window.scrollTo(0, 0);
  }
  function change(next: LessonPlan) {
    setPlan(next);
    setDirty(true);
    setReviewed(false);
    setMessage("");
  }
  function updatePoint(s: number, p: number, update: object) {
    if (!plan) return;
    change({
      ...plan,
      sections: plan.sections.map((section, i) =>
        i === s
          ? {
              ...section,
              points: section.points.map((point, j) =>
                j === p ? { ...point, ...update } : point,
              ),
            }
          : section,
      ),
    });
  }
  function movePoint(target: number) {
    if (!plan || !editing || target === editing[0]) return;
    const [si, pi] = editing;
    const point = plan.sections[si].points[pi];
    const ss = plan.sections
      .map((s, i) =>
        i === si
          ? { ...s, points: s.points.filter((_, j) => j !== pi) }
          : i === target
            ? { ...s, points: [...s.points, point] }
            : s,
      )
      .filter((s) => s.points.length);
    change({ ...plan, sections: ss });
    setEditing(null);
  }
  async function generate() {
    if (!preview) return;
    setBusy(true);
    setError("");
    setMessage("");
    requestKey.current ||= crypto.randomUUID();
    try {
      const j = await aiLessonApi.generate({
        sources,
        fingerprint: preview.fingerprint,
        chapter_id: chapter,
        max_points: maxPoints,
        instructions,
        request_key: requestKey.current,
      });
      if (!mounted.current) return;
      setJob(j);
      setPlan(j.plan);
      go("review", j.id);
      setJobs(await aiLessonApi.jobs());
    } catch (e) {
      if (mounted.current) {
        setError((e as Error).message);
        setJobs(await aiLessonApi.jobs().catch(() => []));
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function persist(importing = false) {
    if (!job || !plan) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const next = importing
        ? await aiLessonApi.import(job, plan, reviewed)
        : await aiLessonApi.save(job, plan);
      setJob(next);
      setPlan(next.plan);
      setDirty(false);
      setReviewed(false);
      setMessage(
        importing
          ? "目录和教案已追加为草稿。请继续预览、补充动画/资料并发布；学生目前看不到这些新知识点。"
          : "候选修改已保存，刷新后仍可继续审核。",
      );
      setJobs(await aiLessonApi.jobs());
      if (importing) setSections(await digitalApi.sections());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const editable = job?.status === "ready";
  const sIndex = editing?.[0] ?? -1,
    pIndex = editing?.[1] ?? -1;
  const current = plan?.sections[sIndex]?.points[pIndex];
  const source = job?.sources.chunks.find((c) => c.ref === current?.source_ref);
  return (
    <AuthoringPage
      title="从授课课件准备目录和教案"
      description="章 → 小节 → 知识点。每章小节数自由；先核对课件文字，再由AI辅助整理，最后教师审核入库。"
      back={{ to: "/teacher/knowledge", label: "返回知识点内容" }}
    >
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
      <nav className="authoring-toolbar" aria-label="AI备课步骤">
        {[
          ["sources", "1 课件与范围"],
          ["generate", "2 教案要求"],
          ["review", "3 目录与正文审核"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={step === key ? "" : "secondary"}
            disabled={
              busy ||
              (key === "generate" && !preview) ||
              (key === "review" && !jobId)
            }
            onClick={() => go(key, key === "review" ? jobId : undefined)}
          >
            {label}
          </button>
        ))}
      </nav>
      {!status?.configured && (
        <p className="notice">
          DeepSeek尚未配置。仍可提取和核对文字；生成教案需在后端.env配置DEEPSEEK_API_KEY并重启服务。
        </p>
      )}
      {step === "sources" && (
        <LessonSources
          onReady={(ss, pp) => {
            setSources(ss);
            setPreview(pp);
            requestKey.current = "";
            go("generate");
          }}
        />
      )}
      {step === "generate" && (
        <section className="authoring-card authoring-form">
          <h2>本次准备哪个章节的内容？</h2>
          <p>
            一个任务对应一个大章中的一段授课内容。AI可以提出多个小节，每个小节包含数量不同的知识点。新大章请先创建，避免整本课程被模型擅自重排。
          </p>
          <fieldset disabled={busy}>
            <label>
              所属大章
              <select
                aria-label="所属大章"
                value={chapter}
                onChange={(e) => {
                  setChapter(Number(e.target.value));
                  requestKey.current = "";
                }}
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <Link to="/teacher/chapters/new">需要新大章？先创建章节</Link>
            <label>
              本批知识点数量上限
              <input
                type="number"
                min={1}
                max={8}
                value={maxPoints}
                onChange={(e) => {
                  setMaxPoints(Number(e.target.value));
                  requestKey.current = "";
                }}
              />
            </label>
            <label>
              教案要求或已有教案样式
              <textarea
                rows={9}
                maxLength={4000}
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  requestKey.current = "";
                }}
                placeholder="例如：面向本校本科生；按问题导入、核心概念、原理精讲、典型案例、易错辨析、总结组织。小节标题按授课主题，不要每页一个知识点。可粘贴你已有教案的结构要求。"
              />
            </label>
            <p>
              默认生成六类正文模块和学习目标，并列出待核对图示、动画及练习建议。动画建议需要后续选择已有交互模板或开发实现；不会生成一个假按钮冒充可运行实验。
            </p>
            <p>
              将发送你已预览的{preview?.characters || 0}字资料至DeepSeek（
              {status?.model}
              ），包含所选专用资料文字，可能产生费用。每次最多8个知识点，不自动重试或发布。
            </p>
            <button
              disabled={
                !status?.configured ||
                !chapter ||
                !preview ||
                maxPoints < 1 ||
                maxPoints > 8
              }
              onClick={generate}
            >
              {busy ? "正在生成，请等待…" : "生成目录与教案候选"}
            </button>
            {error && requestKey.current && (
              <button
                className="secondary"
                disabled={busy || !status?.configured}
                onClick={() => {
                  requestKey.current = "";
                  generate();
                }}
              >
                核对任务记录后，重新请求生成（可能计费）
              </button>
            )}
          </fieldset>
        </section>
      )}
      {step === "review" && !job && <p>正在读取备课任务…</p>}
      {step === "review" && job && (
        <>
          <p>
            备课任务 #{job.id} · {job.model} · {job.status} ·{" "}
            {dirty ? "有未保存修改，请先保存" : "已保存"}
          </p>
          {job.error && <p role="alert">{job.error}</p>}
          {job.sources.warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
          {job.status === "running" && (
            <button
              onClick={() =>
                aiLessonApi
                  .job(job.id)
                  .then((j) => {
                    setJob(j);
                    if (j.status === "ready" || j.status === "imported")
                      setPlan(j.plan);
                  })
                  .catch((e) => setError(e.message))
              }
            >
              刷新任务状态
            </button>
          )}
          {job.status === "imported" && (
            <section className="authoring-card">
              <h2>已入库为知识点草稿</h2>
              <p>
                先确认章节和小节发布状态，再在知识点编辑器预览、完善和发布。已有目录与正文未被覆盖。
              </p>
              {job.imported.map((p) => (
                <p key={p.id}>
                  <Link to={`/teacher/knowledge/${p.id}/content`}>
                    {p.title}：继续编写、关联资料和动画 →
                  </Link>
                </p>
              ))}
              <Link to="/teacher/chapters">查看课程目录</Link>
            </section>
          )}
          {editable && plan && (
            <>
              {!current ? (
                <section className="authoring-card authoring-form">
                  <h2>先审核目录，再逐个核对教案</h2>
                  <p>
                    小节数量不固定，可改名、调整顺序、删除候选；也可选已有小节追加内容。选已有小节时不会改写其原名称和编号。
                  </p>
                  <fieldset disabled={busy}>
                    <label>
                      入库大章
                      <select
                        value={plan.chapter_id}
                        onChange={(e) =>
                          change({
                            ...plan,
                            chapter_id: Number(e.target.value),
                            sections: plan.sections.map((s) => ({
                              ...s,
                              section_id: null,
                            })),
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
                    {plan.sections.map((section, si) => (
                      <section className="authoring-card" key={si}>
                        <h3>小节 {si + 1}</h3>
                        <label>
                          保存到
                          <select
                            value={section.section_id || 0}
                            onChange={(e) =>
                              change({
                                ...plan,
                                sections: plan.sections.map((s, i) =>
                                  i === si
                                    ? {
                                        ...s,
                                        section_id:
                                          Number(e.target.value) || null,
                                      }
                                    : s,
                                ),
                              })
                            }
                          >
                            <option value={0}>新建小节</option>
                            {sections
                              .filter((s) => s.chapter_id === plan.chapter_id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.code} {s.title}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          小节标题
                          <input
                            maxLength={200}
                            value={section.title}
                            onChange={(e) =>
                              change({
                                ...plan,
                                sections: plan.sections.map((s, i) =>
                                  i === si
                                    ? { ...s, title: e.target.value }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                        {!section.section_id && (
                          <label>
                            小节编号（可留空或稍后修改）
                            <input
                              maxLength={80}
                              value={section.code}
                              onChange={(e) =>
                                change({
                                  ...plan,
                                  sections: plan.sections.map((s, i) =>
                                    i === si
                                      ? { ...s, code: e.target.value }
                                      : s,
                                  ),
                                })
                              }
                            />
                          </label>
                        )}
                        {section.points.map((p, pi) => (
                          <div className="outline-point" key={pi}>
                            <strong>{p.title}</strong>
                            <div className="row-actions">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditing([si, pi]);
                                  window.scrollTo(0, 0);
                                }}
                              >
                                整页审核教案
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={!pi}
                                onClick={() => {
                                  const points = [...section.points];
                                  [points[pi - 1], points[pi]] = [
                                    points[pi],
                                    points[pi - 1],
                                  ];
                                  change({
                                    ...plan,
                                    sections: plan.sections.map((s, i) =>
                                      i === si ? { ...s, points } : s,
                                    ),
                                  });
                                }}
                              >
                                上移
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={section.points.length <= 1}
                                onClick={() =>
                                  change({
                                    ...plan,
                                    sections: plan.sections.map((s, i) =>
                                      i === si
                                        ? {
                                            ...s,
                                            points: s.points.filter(
                                              (_, j) => j !== pi,
                                            ),
                                          }
                                        : s,
                                    ),
                                  })
                                }
                              >
                                移除候选
                              </button>
                            </div>
                          </div>
                        ))}
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={!si}
                            onClick={() => {
                              const ss = [...plan.sections];
                              [ss[si - 1], ss[si]] = [ss[si], ss[si - 1]];
                              change({ ...plan, sections: ss });
                            }}
                          >
                            小节上移
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={plan.sections.length <= 1}
                            onClick={() =>
                              change({
                                ...plan,
                                sections: plan.sections.filter(
                                  (_, i) => i !== si,
                                ),
                              })
                            }
                          >
                            移除此小节候选
                          </button>
                        </div>
                      </section>
                    ))}
                  </fieldset>
                </section>
              ) : (
                <section className="authoring-card authoring-form">
                  <button
                    className="secondary"
                    onClick={() => setEditing(null)}
                  >
                    ← 返回候选目录（保留本页编辑）
                  </button>
                  <h2>整页审核这份教案</h2>
                  <fieldset disabled={busy}>
                    <label>
                      调整知识点所属小节
                      <select
                        value={sIndex}
                        onChange={(e) => movePoint(Number(e.target.value))}
                      >
                        {plan.sections.map((s, i) => (
                          <option value={i} key={i}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      知识点标题
                      <input
                        maxLength={200}
                        value={current.title}
                        onChange={(e) =>
                          updatePoint(sIndex, pIndex, { title: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      概述
                      <textarea
                        rows={3}
                        maxLength={2000}
                        value={current.summary}
                        onChange={(e) =>
                          updatePoint(sIndex, pIndex, {
                            summary: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      学习目标
                      <textarea
                        rows={4}
                        maxLength={5000}
                        value={current.objectives}
                        onChange={(e) =>
                          updatePoint(sIndex, pIndex, {
                            objectives: e.target.value,
                          })
                        }
                      />
                    </label>
                    {current.blocks.map((b, bi) => (
                      <details key={bi} open={bi === 0}>
                        <summary>
                          {lessonKinds[b.kind]} · {b.title}
                        </summary>
                        <label>
                          模块标题
                          <input
                            maxLength={200}
                            value={b.title}
                            onChange={(e) =>
                              updatePoint(sIndex, pIndex, {
                                blocks: current.blocks.map((x, i) =>
                                  i === bi
                                    ? { ...x, title: e.target.value }
                                    : x,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          教案正文（Markdown）
                          <textarea
                            rows={12}
                            maxLength={12000}
                            value={b.text}
                            onChange={(e) =>
                              updatePoint(sIndex, pIndex, {
                                blocks: current.blocks.map((x, i) =>
                                  i === bi ? { ...x, text: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </label>
                      </details>
                    ))}
                    <label>
                      教师核对事项 / 图示与动画建议
                      <textarea
                        rows={5}
                        maxLength={3000}
                        value={current.teaching_note}
                        onChange={(e) =>
                          updatePoint(sIndex, pIndex, {
                            teaching_note: e.target.value,
                          })
                        }
                      />
                    </label>
                    <h3>引用依据</h3>
                    <p>
                      {source?.title} · 第{source?.page}页
                    </p>
                    <blockquote>{current.source_quote}</blockquote>
                    <details>
                      <summary>展开本页实际摘录</summary>
                      <pre className="source-excerpt">{source?.text}</pre>
                    </details>
                  </fieldset>
                </section>
              )}
              <section className="authoring-card authoring-form">
                <h2>保存审核结果</h2>
                <p>
                  候选修改需点保存。入库会追加未发布小节和知识点；沿用已有小节的发布状态，但新知识点仍是草稿。不会替换现有内容，私有原件不会转成公共文件。
                </p>
                <button
                  disabled={busy || !dirty}
                  onClick={() => persist(false)}
                >
                  保存候选修改
                </button>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    disabled={busy}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  我已核对目录、正文与引用，确认可以把这些内容存为课程草稿
                </label>
                <button
                  disabled={busy || !reviewed}
                  onClick={() => persist(true)}
                >
                  审核通过，批量存为草稿
                </button>
              </section>
            </>
          )}
        </>
      )}
      <details className="authoring-card">
        <summary>最近备课任务（刷新后可继续）</summary>
        {!jobs.length && <p>暂无任务。</p>}
        {jobs.map((j) => (
          <div className="outline-point" key={j.id}>
            <span>
              #{j.id} · {j.created_at} · {j.status}
            </span>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => go("review", j.id)}
            >
              打开任务
            </button>
          </div>
        ))}
      </details>
    </AuthoringPage>
  );
}
