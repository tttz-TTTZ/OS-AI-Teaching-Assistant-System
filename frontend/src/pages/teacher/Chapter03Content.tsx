import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, Course, courses, request, teacherApi } from "../../api";
import { Content, digitalApi, Section } from "../../digital";
import { Notice } from "../../components";
import ContentView from "../../learning/ContentView";
import { AuthoringPage } from "./Authoring";

type RecordSpec = {
  id: string;
  name: string;
  section: string;
  categories: string;
  learning_goal: string;
  recommendation_reason: string;
  prerequisites: string;
  core_explanation: string;
  rules_and_limits: string;
  misconception_and_correction: string;
  example: string;
  presentation: string;
  evidence_status: string;
  formal_recommendation: string;
  related_ids: string[];
  issue_ids: string[];
  sources: {
    filename: string;
    physical_pages: number[];
    quote_page: number;
    short_quote: string;
    evidence_type: string;
  }[];
};
type Unit = {
  code: string;
  title: string;
  section: string;
  summary: string;
  objectives: string;
  blocks: Content["blocks"];
  record_ids: string[];
};
type Package = {
  notice: string;
  sources: { id: string; filename: string; slides: number }[];
  sections: { code: string; title: string }[];
  items: Unit[];
  records: RecordSpec[];
  summaries: { id: string; name: string; summary: string; source: string }[];
  issues: {
    id: string;
    title: string;
    problem: string;
    required_resolution: string;
    status: string;
    source: string;
  }[];
  deferred: string[];
};
type Result = {
  chapter_id: number;
  package_changed?: boolean;
  already_imported: boolean;
  direct_published?: boolean;
  sections: Record<string, number>;
  points: { code: string; id: number }[];
};
type Plan = {
  chapter: Chapter;
  result: Result | null;
  sections: {
    code: string;
    title: string;
    conflict: boolean;
    id: number | null;
    existing_title: string;
  }[];
};
const base = "/teacher/chapter-content/chapter03";
const stages = [
  ["preview", "阅读预填内容"],
  ["target", "选择目录，一键发布"],
  ["review", "发布状态与后续修改"],
] as const;

export default function Chapter03Content() {
  const [params, setParams] = useSearchParams();
  const stage = stages.some(([s]) => s === params.get("stage"))
    ? params.get("stage")!
    : "preview";
  const chapter = Number(params.get("chapter")) || 0;
  const [data, setData] = useState<Package>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [courseList, setCourses] = useState<Course[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<Plan>();
  const [result, setResult] = useState<Result | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  function navigate(updates: Record<string, string>) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      Object.entries(updates).forEach(([k, v]) => next.set(k, v));
      return next;
    });
  }
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([request<Package>(base), teacherApi.chapters(), courses()])
      .then(([p, c, cs]) => {
        if (active) {
          setData(p);
          setChapters(c);
          setCourses(cs);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  useEffect(() => {
    let active = true;
    setError("");
    setMapping({});
    setPlan(undefined);
    setConfirmed(false);
    setResult(null);
    setSections([]);
    setLoadingTarget(!!chapter);
    if (chapter)
      Promise.all([
        digitalApi.sections(chapter),
        request<{ result: Result | null }>(
          base + "/status?chapter_id=" + chapter,
        ),
      ])
        .then(([s, r]) => {
          if (active) {
            setSections(s);
            setResult(r.result);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoadingTarget(false);
        });
    return () => {
      active = false;
    };
  }, [chapter, reload]);
  async function checkTarget() {
    setError("");
    setBusy(true);
    setPlan(undefined);
    setConfirmed(false);
    try {
      const p = await request<Plan>(base + "/plan", {
        method: "POST",
        body: JSON.stringify({ chapter_id: chapter, section_map: mapping }),
      });
      setPlan(p);
      setResult(p.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      !plan ||
      plan.chapter.id !== chapter ||
      !confirmed ||
      busy ||
      loadingTarget
    )
      return;
    setError("");
    setBusy(true);
    try {
      setResult(
        await request<Result>(base + "/import", {
          method: "POST",
          body: JSON.stringify({ chapter_id: chapter, section_map: mapping }),
        }),
      );
      navigate({ stage: "review" });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publishNow() {
    if (!chapter || busy || loadingTarget) return;
    setError("");
    setBusy(true);
    try {
      setResult(
        await request<Result>(base + "/publish", {
          method: "POST",
          body: JSON.stringify({ chapter_id: chapter, section_map: mapping }),
        }),
      );
      navigate({ stage: "review" });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const unit =
    data?.items.find((i) => i.code === params.get("unit")) || data?.items[0];
  const courseName = (id: number) =>
    courseList.find((c) => c.id === id)?.title || `课程${id}`;
  const target = chapters.find((c) => c.id === chapter);
  const targetLocked = busy || loadingTarget;
  return (
    <AuthoringPage
      title="第三章内容与发布"
      description="已预填12个学习单元，选择目标目录后可直接全部发布，无需逐项审核，以后随时修改。"
      back={{ to: "/teacher/knowledge", label: "返回知识点管理" }}
    >
      <Notice error={error} />
      {!data && !error && <p role="status">正在读取第三章内容…</p>}
      {error && (
        <button className="secondary" onClick={() => setReload((x) => x + 1)}>
          重新加载
        </button>
      )}
      {data && (
        <>
          <nav className="authoring-steps" aria-label="第三章内容步骤">
            {stages.map(([key, label], i) => (
              <button
                key={key}
                disabled={targetLocked}
                className={stage === key ? "current" : ""}
                aria-current={stage === key ? "step" : undefined}
                onClick={() => {
                  navigate({ stage: key });
                  window.scrollTo(0, 0);
                }}
              >
                <span>{i + 1}</span>
                {label}
              </button>
            ))}
          </nav>
          {stage === "preview" && (
            <>
              <section className="authoring-card">
                <h2>每次查看一个学习单元</h2>
                <p>{data.notice}</p>
                <label>
                  预填学习单元
                  <select
                    aria-label="预填学习单元"
                    value={unit?.code || ""}
                    onChange={(e) => navigate({ unit: e.target.value })}
                  >
                    {data.items.map((i) => (
                      <option key={i.code} value={i.code}>
                        {i.title}
                      </option>
                    ))}
                  </select>
                </label>
                {unit && (
                  <>
                    <p>
                      建议目录 {unit.section} · {unit.record_ids.join("、")}
                      。目录编号、归属、顺序、名称和页码后续均可修改。
                    </p>
                    <ContentView
                      key={unit.code}
                      preview
                      content={{
                        chapter_id: 0,
                        section_id: null,
                        code: unit.code,
                        title: unit.title,
                        summary: unit.summary,
                        objectives: unit.objectives,
                        blocks: unit.blocks,
                        sort_order: 0,
                        minutes: null,
                        emphasis: "原理与静态图示",
                        source_title: "",
                        source_note: "",
                        printed_pages: "",
                        pdf_pages: "",
                        related_ids: [],
                        lab: false,
                      }}
                    />
                    <details>
                      <summary>本单元的完整分析与来源（教师核对）</summary>
                      {data.records
                        .filter((r) => unit.record_ids.includes(r.id))
                        .map((r) => (
                          <section key={r.id}>
                            <h3>
                              {r.id} · {r.name}
                            </h3>
                            <p>
                              原目录：{r.section}；分类：{r.categories}
                            </p>
                            {(
                              [
                                ["学习目标", r.learning_goal],
                                ["推荐理由", r.recommendation_reason],
                                ["前置知识", r.prerequisites],
                                ["核心原理", r.core_explanation],
                                ["规则与限制", r.rules_and_limits],
                                ["误解纠正", r.misconception_and_correction],
                                ["示例", r.example],
                                ["呈现建议", r.presentation],
                                ["依据状态", r.evidence_status],
                                ["正式学习建议", r.formal_recommendation],
                              ] as const
                            ).map(([label, text]) => (
                              <p key={label}>
                                <strong>{label}：</strong>
                                {text}
                              </p>
                            ))}
                            {r.sources.map((s, i) => (
                              <p key={i}>
                                {s.filename} · 物理页{" "}
                                {s.physical_pages.join("、")}；第{s.quote_page}
                                页摘录：“{s.short_quote}”（{s.evidence_type}）
                              </p>
                            ))}
                            <p>
                              关联：{r.related_ids.join("、")}；待核实：
                              {r.issue_ids.join("、")}
                            </p>
                          </section>
                        ))}
                    </details>
                  </>
                )}
                <button onClick={() => navigate({ stage: "target" })}>
                  内容看好了，选择导入目录 →
                </button>
              </section>
              <section className="authoring-card">
                <details>
                  <summary>6份资料与普通内容速览</summary>
                  {data.sources.map((s) => (
                    <p key={s.id}>
                      {s.id} · {s.filename} · {s.slides}物理页
                    </p>
                  ))}
                  {data.summaries.map((s) => (
                    <p key={s.id}>
                      <strong>{s.name}：</strong>
                      {s.summary}
                      <br />
                      {s.source}
                    </p>
                  ))}
                </details>
              </section>
              <section className="authoring-card">
                <details>
                  <summary>28项待核实与未实现功能</summary>
                  <p>建议解释不等于教师已经确认；不会自动关闭这些问题。</p>
                  {data.issues.map((i) => (
                    <p key={i.id}>
                      <strong>
                        {i.id} · {i.title}
                      </strong>
                      <br />
                      {i.problem}
                      <br />
                      {i.required_resolution}
                      <br />
                      <small>
                        {i.source} · {i.status}
                      </small>
                    </p>
                  ))}
                  {data.deferred.map((d) => (
                    <p key={d}>{d}</p>
                  ))}
                </details>
              </section>
            </>
          )}
          {stage === "target" && (
            <section className="authoring-card authoring-form">
              <h2>将存储管理内容放到哪里？</h2>
              <p>
                课件第三章不等于数据库ID3。请选择真实课程下的目标章；不会重命名、清空、归档或自动发布原有内容。
              </p>
              <label>
                目标课程与章节
                <select
                  aria-label="第三章目标章节"
                  value={chapter || ""}
                  disabled={busy}
                  onChange={(e) => navigate({ chapter: e.target.value })}
                >
                  <option value="">请明确选择目标章</option>
                  {courseList.map((c) => (
                    <optgroup key={c.id} label={c.title}>
                      {chapters
                        .filter((ch) => ch.course_id === c.id)
                        .map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.textbook_number
                              ? ch.textbook_number + " · "
                              : ""}
                            {ch.title}（{c.title}）
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              {!chapters.length && (
                <p>
                  还没有章节，请先
                  <Link to="/teacher/chapters/new">创建课程章节</Link>。
                </p>
              )}
              {target && (
                <p>
                  已选：{courseName(target.course_id)} / {target.title}
                  。建议小节可映射到任意已有小节；空值只复用编号、标题完全一致的目录，否则新建草稿。
                </p>
              )}
              {loadingTarget && <p role="status">正在读取目标目录…</p>}
              {!!chapter &&
                data.sections.map((s) => (
                  <label key={s.code}>
                    {s.code} · {s.title} 的归属
                    <select
                      aria-label={`小节映射 ${s.code}`}
                      value={mapping[s.code] || ""}
                      disabled={targetLocked}
                      onChange={(e) => {
                        const next = { ...mapping };
                        if (e.target.value)
                          next[s.code] = Number(e.target.value);
                        else delete next[s.code];
                        setMapping(next);
                        setPlan(undefined);
                        setConfirmed(false);
                      }}
                    >
                      <option value="">
                        新建草稿 / 复用编号标题相同的小节
                      </option>
                      {sections.map((existing) => (
                        <option key={existing.id} value={existing.id}>
                          {existing.code} {existing.title}（
                          {existing.published ? "已发布" : "未发布"}）
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <button disabled={!chapter || targetLocked} onClick={checkTarget}>
                {busy ? "正在检查…" : "检查目标与目录"}
              </button>
              {plan && (
                <section className="card">
                  <h3>确认导入预览</h3>
                  <p>
                    目标：{courseName(plan.chapter.course_id)} /{" "}
                    {plan.chapter.title}
                    。可直接发布12个单元及其所属章、小节；已有草稿使用当前内容，保留你的修改。
                  </p>
                  {plan.sections.map((s) => (
                    <p key={s.code}>
                      {s.code} {s.title} →{" "}
                      {s.conflict
                        ? "编号冲突：请在上方明确映射"
                        : s.id
                          ? `复用「${s.existing_title}」`
                          : "新建未发布小节"}
                    </p>
                  ))}
                  <p>
                    发布前自动备份并校验，全部成功才发布；不创建尚未支持的实验，不改其他章节。
                  </p>
                  {(!result || result.chapter_id === chapter) && (
                    <button
                      disabled={
                        targetLocked ||
                        !!result?.direct_published ||
                        !!result?.package_changed ||
                        plan.sections.some((s) => s.conflict)
                      }
                      onClick={publishNow}
                    >
                      {busy
                        ? "正在备份并发布…"
                        : result?.direct_published
                          ? "已直接发布"
                          : "直接应用并发布全部内容"}
                    </button>
                  )}
                  {result ? (
                    <>
                      <p role="status">
                        本课程已经导入此包，目标章ID：{result.chapter_id}
                        。重复操作不覆盖教师修改。
                        {result.package_changed &&
                          "内容包版本已变化，请先核对，不重新覆盖。"}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          navigate({
                            chapter: String(result.chapter_id),
                            stage: "review",
                          })
                        }
                      >
                        查看发布状态与修改入口
                      </button>
                    </>
                  ) : (
                    <>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={confirmed}
                          onChange={(e) => setConfirmed(e.target.checked)}
                        />
                        我已核对目标章节与小节，只保存待审核草稿
                      </label>
                      <button
                        disabled={
                          !confirmed ||
                          targetLocked ||
                          plan.sections.some((s) => s.conflict)
                        }
                        onClick={save}
                      >
                        {busy ? "正在保存…" : "保存12个单元草稿"}
                      </button>
                    </>
                  )}
                </section>
              )}
            </section>
          )}
          {stage === "review" && (
            <section className="authoring-card">
              <h2>发布状态与后续修改</h2>
              {!result ? (
                <>
                  <p>先选择已导入的目标章，这里会显示每个单元的编辑入口。</p>
                  <button onClick={() => navigate({ stage: "target" })}>
                    选择目标章 →
                  </button>
                </>
              ) : (
                <>
                  <p role="status">
                    {result.direct_published
                      ? "第三章已直接发布。以后可随时修改，重复操作不会覆盖修改或恢复已撤回内容。"
                      : "导入登记已保存。已有草稿可一键全部发布，无需逐项审核。"}
                  </p>
                  <p>
                    发布时自动处理目标章和所用小节。后续修改沿用现有编辑器；保存新草稿不会立刻改变学生正在阅读的发布版本。
                  </p>
                  {!result.direct_published &&
                    result.chapter_id === chapter && (
                      <button
                        disabled={targetLocked || !!result.package_changed}
                        onClick={publishNow}
                      >
                        {busy ? "正在备份并发布…" : "直接发布已有全部内容"}
                      </button>
                    )}
                  <h3>1. 目录与编号</h3>
                  <Link to={`/teacher/chapters/${result.chapter_id}/edit`}>
                    修改目标章名称、编号、页码与发布状态
                  </Link>
                  {Object.entries(result.sections).map(([code, id]) => (
                    <p key={code}>
                      <Link to={`/teacher/sections/${id}/edit`}>
                        修改 {code} 小节名称、顺序与发布状态
                      </Link>
                    </p>
                  ))}
                  <h3>2. 需要时再修改内容</h3>
                  {result.points.map((p) => (
                    <div className="module-row" key={p.id}>
                      <span>
                        {data.items.find((i) => i.code === p.code)?.title ||
                          p.code}
                      </span>
                      <div className="row-actions">
                        <Link to={`/teacher/knowledge/${p.id}/content`}>
                          修改内容
                        </Link>
                        <Link to={`/teacher/knowledge/${p.id}/preview`}>
                          预览发布
                        </Link>
                      </div>
                    </div>
                  ))}
                  <h3>3. 关联实际课件与正式练习</h3>
                  <p>
                    请到<Link to="/teacher/materials">公共资料管理</Link>
                    关联已经上传的文件；报告引用不是文件附件。正式题由
                    <Link to="/teacher/questions">练习题管理</Link>
                    维护。尚无资料或题目时学生看到空状态。
                  </p>
                  <p>
                    存储管理算法与机制动画尚未实现，本轮不提供虚假运行入口。现有FCFS/SJF/RR实验不受影响。
                  </p>
                  <Link to={`/teacher/chapters?chapter=${result.chapter_id}`}>
                    返回本章目录
                  </Link>
                </>
              )}
            </section>
          )}
        </>
      )}
    </AuthoringPage>
  );
}
