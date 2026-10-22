import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chapter, request, teacherApi } from "../../api";
import { Content, digitalApi, Section } from "../../digital";
import { Notice } from "../../components";
import ContentView from "../../learning/ContentView";
import { AuthoringPage } from "./Authoring";

type Package = {
  title: string;
  notice: string;
  sources: { id: string; filename: string; slides: number; hidden: number[] }[];
  sections: { code: string; title: string }[];
  items: {
    code: string;
    title: string;
    section: string;
    phase: string;
    summary: string;
    objectives: string;
    blocks: Content["blocks"];
    record_ids: string[];
  }[];
  records: { id: string; name: string; formal: string }[];
  summaries: { code: string; text: string; source: string; handling: string }[];
  issues: { code: string; text: string; resolution: string; status: string }[];
  experiments: { code: string; algorithm: string; title: string }[];
  deferred: string[];
};
type Result = {
  chapter_id: number;
  already_imported: boolean;
  package_changed?: boolean;
  direct_published?: boolean;
  already_published?: boolean;
  points: { code: string; id: number }[];
  sections: Record<string, number>;
  experiments: { code: string; id: number; algorithm: string }[];
};
type Plan = {
  chapter: Chapter;
  sections: {
    code: string;
    title: string;
    id: number | null;
    conflict: boolean;
    existing_title: string;
  }[];
  result: Result | null;
  notice: string;
};
const base = "/teacher/chapter-content/chapter02";
const stages = [
  ["preview", "阅读预填内容"],
  ["target", "选择目录并应用"],
  ["review", "发布状态与后续修改"],
] as const;

export default function Chapter02Content() {
  const [params, setParams] = useSearchParams();
  const stage = stages.some(([s]) => s === params.get("stage"))
    ? params.get("stage")!
    : "preview";
  const chapter = Number(params.get("chapter")) || 0;
  const selected = params.get("unit") || "CH02-U005";
  const [data, setData] = useState<Package>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [plan, setPlan] = useState<Plan>();
  const [result, setResult] = useState<Result | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  function navigate(updates: Record<string, string>) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      for (const [k, v] of Object.entries(updates)) next.set(k, v);
      return next;
    });
  }
  useEffect(() => {
    let active = true;
    setError("");
    Promise.all([request<Package>(base), teacherApi.chapters()])
      .then(([p, c]) => {
        if (active) {
          setData(p);
          setChapters(c);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    let active = true;
    setMapping({});
    setPlan(undefined);
    setConfirmed(false);
    setResult(null);
    setSections([]);
    if (chapter)
      Promise.all([
        digitalApi.sections(chapter),
        request<{ result: Result | null }>(
          base + "/status?chapter_id=" + chapter,
        ),
      ])
        .then(([s, status]) => {
          if (active) {
            setSections(s);
            setResult(status.result);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [chapter]);
  async function checkTarget() {
    setError("");
    setBusy(true);
    setConfirmed(false);
    setPlan(undefined);
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
  async function saveDrafts() {
    if (!confirmed || !plan || busy) return;
    setError("");
    setBusy(true);
    try {
      const saved = await request<Result>(base + "/import", {
        method: "POST",
        body: JSON.stringify({ chapter_id: chapter, section_map: mapping }),
      });
      setResult(saved);
      navigate({ stage: "review" });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publishNow() {
    if (busy || !chapter) return;
    setError("");
    setBusy(true);
    try {
      const saved = await request<Result>(base + "/publish", {
        method: "POST",
        body: JSON.stringify({ chapter_id: chapter, section_map: mapping }),
      });
      setResult(saved);
      navigate({ stage: "review" });
      window.scrollTo(0, 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const item = data?.items.find((i) => i.code === selected) || data?.items[0];
  return (
    <AuthoringPage
      title="第二章预填内容与审核"
      description="选择目标目录后可直接发布，无需逐项审核；以后需要时再修改。"
      back={{ to: "/teacher/knowledge", label: "返回知识点管理" }}
    >
      <Notice error={error} />
      {!data && !error && <p role="status">正在读取第二章内容…</p>}
      {!data && error && (
        <button onClick={() => setRefresh((x) => x + 1)}>重新加载</button>
      )}
      {data && (
        <>
          <nav className="authoring-steps" aria-label="第二章内容步骤">
            {stages.map(([key, label], i) => (
              <button
                key={key}
                disabled={busy}
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
                <p>
                  11个核心单元、1个可选进阶；24条分析记录已去重，不要求教师重新录入。
                </p>
                <label>
                  预填学习单元
                  <select
                    aria-label="预填学习单元"
                    value={item?.code || ""}
                    onChange={(e) => navigate({ unit: e.target.value })}
                  >
                    {data.items.map((i) => (
                      <option key={i.code} value={i.code}>
                        {i.title} · {i.phase}
                      </option>
                    ))}
                  </select>
                </label>
                {item && (
                  <>
                    <p>
                      {item.record_ids.join("、")} · 课件目录 {item.section}
                      （显示编号后续可修改）
                    </p>
                    <ContentView
                      key={item.code}
                      preview
                      content={{
                        chapter_id: 0,
                        section_id: null,
                        code: item.code,
                        title: item.title,
                        summary: item.summary,
                        objectives: item.objectives,
                        blocks: item.blocks,
                        sort_order: 0,
                        minutes: null,
                        emphasis: item.phase,
                        source_title: "",
                        source_note: "",
                        printed_pages: "",
                        pdf_pages: "",
                        related_ids: [],
                        lab: false,
                      }}
                    />
                  </>
                )}
                <button onClick={() => navigate({ stage: "target" })}>
                  内容看好了，选择导入目录 →
                </button>
              </section>
              <section className="authoring-card">
                <details>
                  <summary>来源与24条内容记录（教师核对）</summary>
                  <p>
                    按最新授权可直接发布；来源与待核实事项保留供以后修订，也可选择只保存草稿。
                  </p>
                  {data.sources.map((s) => (
                    <p key={s.id}>
                      {s.id} · {s.filename} · {s.slides}页
                      {s.hidden.length
                        ? `（隐藏页：${s.hidden.join("、")}）`
                        : ""}
                    </p>
                  ))}
                  {data.records.map((r) => (
                    <p key={r.id}>
                      <strong>
                        {r.id} · {r.name}
                      </strong>
                      <br />
                      {r.formal}
                    </p>
                  ))}
                </details>
              </section>
              <section className="authoring-card">
                <details>
                  <summary>普通内容摘要</summary>
                  {data.summaries.map((s) => (
                    <p key={s.code}>
                      <strong>{s.code}</strong> {s.text}
                      <br />
                      <small>
                        {s.source}；{s.handling}
                      </small>
                    </p>
                  ))}
                </details>
              </section>
              <section className="authoring-card">
                <details>
                  <summary>21项待核实与暂缓功能</summary>
                  {data.issues.map((i) => (
                    <p key={i.code}>
                      <strong>
                        {i.code} · {i.status}
                      </strong>{" "}
                      {i.text}
                      <br />
                      {i.resolution}
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
              <h2>将第二章内容放到哪里？</h2>
              <p>
                不会自动猜测第二章ID，也不会重命名或清空已有章节。新建小节默认未发布；已有小节的标题和发布状态保留。
              </p>
              <label>
                目标章节
                <select
                  aria-label="第二章目标章节"
                  value={chapter || ""}
                  disabled={busy}
                  onChange={(e) => {
                    setError("");
                    navigate({ chapter: e.target.value });
                  }}
                >
                  <option value="">请明确选择目标章</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}（课程{c.course_id}）
                    </option>
                  ))}
                </select>
              </label>
              {!chapters.length && (
                <p>
                  还没有章节，请先
                  <Link to="/teacher/chapters/new">创建课程章节</Link>。
                </p>
              )}
              {!!chapter &&
                data.sections.map((s) => (
                  <label key={s.code}>
                    {s.code} · {s.title} 的归属
                    <select
                      aria-label={`小节映射 ${s.code}`}
                      disabled={busy}
                      value={mapping[s.code] || ""}
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
                        新建草稿小节 / 复用编号标题完全相同的小节
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
              <button disabled={!chapter || busy} onClick={checkTarget}>
                {busy ? "正在检查…" : "检查目标与目录"}
              </button>
              {plan && (
                <section className="card">
                  <h3>确认导入预览</h3>
                  <p>
                    目标：{plan.chapter.title}，课程{plan.chapter.course_id}
                    。可直接发布12个单元和3个已有引擎实验；已有草稿使用当前内容，不覆盖修改。
                  </p>
                  <p>
                    直接发布前会成套备份并运行内容及算法校验，同时发布目标章和包内单元所在小节；不改其他章，不扩大未发布课程的公开范围。
                  </p>
                  {(!result || result.chapter_id === chapter) && (
                    <button
                      disabled={
                        busy ||
                        !!result?.direct_published ||
                        plan.sections.some((s) => s.conflict)
                      }
                      onClick={publishNow}
                    >
                      {busy
                        ? "正在校验并发布…"
                        : result?.direct_published
                          ? "已直接发布"
                          : "直接应用并发布"}
                    </button>
                  )}
                  {plan.sections.map((s) => (
                    <p key={s.code}>
                      {s.code} {s.title} →{" "}
                      {s.conflict
                        ? "编号冲突：请在上方明确选择已有小节"
                        : s.id
                          ? `复用「${s.existing_title}」`
                          : "新建未发布小节"}
                    </p>
                  ))}
                  {result ? (
                    <p role="status">
                      本课程已保存此包（目标章ID：{result.chapter_id}
                      ）。不会重新覆盖教师修改。
                      {result.package_changed && "包版本发生变化，请先核对。"}
                      <button
                        className="secondary"
                        onClick={() =>
                          navigate({
                            chapter: String(result.chapter_id),
                            stage: "review",
                          })
                        }
                      >
                        查看已有导入与审核入口
                      </button>
                    </p>
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
                          busy ||
                          plan.sections.some((s) => s.conflict)
                        }
                        onClick={saveDrafts}
                      >
                        {busy ? "正在保存…" : "保存12个单元及3个实验草稿"}
                      </button>
                    </>
                  )}
                </section>
              )}
            </section>
          )}
          {stage === "review" && (
            <section className="authoring-card">
              <h2>发布状态，保留后续修改</h2>
              {!result ? (
                <>
                  <p>
                    尚未选择已导入的目标章。先选择目标并应用，这里会提供后续修改入口。
                  </p>
                  <button onClick={() => navigate({ stage: "target" })}>
                    选择目标章 →
                  </button>
                </>
              ) : (
                <>
                  <p role="status">
                    {result.direct_published
                      ? "第二章已直接发布。重复应用不会覆盖之后的修改；后续可见性以各内容当前发布状态为准。"
                      : "已保存草稿，可直接发布，无需逐项审核。"}
                  </p>
                  <p>
                    直接发布会检查内容、重算已有算法并完成发布。后续修改仍使用原编辑器；保存新草稿不会立即改变学生正在阅读的版本。
                  </p>
                  {!result.direct_published &&
                    result.chapter_id === chapter && (
                      <button disabled={busy} onClick={publishNow}>
                        {busy ? "正在校验并发布…" : "直接发布已有内容"}
                      </button>
                    )}
                  <h3>1. 目录与编号</h3>
                  {Object.entries(result.sections).map(([code, id]) => (
                    <p key={code}>
                      <Link to={`/teacher/sections/${id}/edit`}>
                        修改 {code} 小节标题、顺序与发布状态
                      </Link>
                    </p>
                  ))}
                  <h3>2. 知识单元</h3>
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
                  <h3>3. 已有引擎的教学实验</h3>
                  {result.experiments.map((e) => (
                    <p key={e.id}>
                      <Link to={`/teacher/experiments/${e.id}/preview`}>
                        {e.algorithm.toUpperCase()}：试运行、审核与发布
                      </Link>
                    </p>
                  ))}
                  <h3>4. 关联实际课件</h3>
                  <p>
                    文件名和物理页已保留在教师来源说明中，但尚未绑定实际资料。请在
                    <Link to="/teacher/materials">公共资料管理</Link>
                    选择已上传课件，关联对应知识点。没有实际文件时学生看到真实空状态，不提供伪造下载链接。
                  </p>
                  <Link to={`/teacher/chapters?chapter=${result.chapter_id}`}>
                    返回本章目录核对
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
