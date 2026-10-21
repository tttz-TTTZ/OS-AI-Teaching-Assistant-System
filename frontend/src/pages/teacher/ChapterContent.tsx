import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { request, teacherApi, Chapter } from "../../api";
import { ContentBlock } from "../../digital";
import { Notice } from "../../components";
import ContentView from "../../learning/ContentView";
import { AuthoringPage } from "./Authoring";

type Item = {
  code: string;
  title: string;
  section: string;
  phase: string;
  importable: boolean;
  summary: string;
  objectives: string;
  blocks: ContentBlock[];
  refs: { source_id: string; pages: string }[];
};
type Package = {
  title: string;
  notice: string;
  sources: {
    id: string;
    filename: string;
    slides: number;
    conversion_note: string;
  }[];
  items: Item[];
  issues: { code: string; text: string }[];
  summaries: {
    code: string;
    title: string;
    source_id: string;
    pages: string;
    text: string;
  }[];
  animations: { code: string; title: string; point: string; status: string }[];
};
type Result = {
  points: { code: string; id: number }[];
  experiment_id: number;
  already_imported?: boolean;
  already_applied?: boolean;
  direct_applied?: boolean;
  chapter_id: number;
};
export default function ChapterContent() {
  const [data, setData] = useState<Package>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapter, setChapter] = useState("");
  const [selected, setSelected] = useState("CH01-K001");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  useEffect(() => {
    Promise.all([
      request<Package>("/teacher/chapter-content/chapter01"),
      teacherApi.chapters(),
      request<{ applications: Result[] }>(
        "/teacher/chapter-content/chapter01/application",
      ),
    ])
      .then(([p, c, status]) => {
        setData(p);
        setChapters(c);
        if (status.applications.length === 1) {
          setResult(status.applications[0]);
          setChapter(String(status.applications[0].chapter_id));
        }
      })
      .catch((e) => setError(e.message));
  }, []);
  async function applyContent() {
    setError("");
    setBusy(true);
    try {
      setResult(
        await request<Result>("/teacher/chapter-content/chapter01/apply", {
          method: "POST",
          body: JSON.stringify({ chapter_id: Number(chapter) }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const item = data?.items.find((i) => i.code === selected);
  return (
    <AuthoringPage
      title="第一章课程内容"
      description="第一章新内容由系统直接应用并发布；不需要逐条审核。"
      back={{ to: "/teacher/knowledge", label: "返回知识点管理" }}
    >
      <Notice error={error} />
      {!data && !error && <p>正在加载已填写内容…</p>}
      {data && (
        <>
          <p className="notice">{data.notice}</p>
          <nav className="chapter-review-nav" aria-label="课程内容导航">
            <a href="#chapter-review-content">知识卡与图示</a>
            <a href="#chapter-review-sources">来源</a>
            <a href="#chapter-review-summaries">普通摘要</a>
            <a href="#chapter-review-issues">待核实与后续动画</a>
            <a href="#chapter-review-import">应用状态</a>
          </nav>
          <section id="chapter-review-content" className="card">
            <h2>已填写的知识卡与图示</h2>
            <label>
              选择查看内容
              <select
                aria-label="选择查看内容"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                {data.items.map((i) => (
                  <option key={i.code} value={i.code}>
                    {i.code} · {i.title} · {i.phase}
                  </option>
                ))}
              </select>
            </label>
            {item && (
              <>
                <h2>{item.title}</h2>
                <p>
                  {item.phase} · 归属 {item.section} ·{" "}
                  {item.importable
                    ? "已填写课程内容"
                    : "仅登记待核实，不导入正式知识点"}
                </p>
                <p>
                  {item.refs
                    .map((r) => `${r.source_id} 第${r.pages}张`)
                    .join("；")}
                  。依据报告，未直接核验原PPT。展开解释、重绘和新增例子均为教学补充。
                </p>
                <ContentView
                  key={item.code}
                  content={{
                    chapter_id: 0,
                    section_id: null,
                    code: item.code,
                    title: item.title,
                    summary: item.summary,
                    objectives: item.objectives,
                    sort_order: 0,
                    minutes: null,
                    emphasis: "课程内容",
                    source_title: "四份教师PPT（报告转述）",
                    source_note:
                      "不使用教材PDF；原图、历史代码及关系方向保留核验。",
                    printed_pages: "",
                    pdf_pages: "",
                    related_ids: [],
                    lab: false,
                    blocks: item.blocks,
                  }}
                  preview
                />
                {result?.points.find((p) => p.code === item.code) && (
                  <Link
                    className="button"
                    to={`/teacher/knowledge/${result.points.find((p) => p.code === item.code)!.id}/preview`}
                  >
                    查看当前内容
                  </Link>
                )}
              </>
            )}
          </section>
          <section className="card" id="chapter-review-sources">
            <h2>课程来源：仅四份PPT，共143张</h2>
            {data.sources.map((s) => (
              <p key={s.id}>
                <strong>
                  {s.id} · {s.filename}
                </strong>
                <br />
                {s.slides}张 · {s.conversion_note}
              </p>
            ))}
            <p>
              本包不附原PPT；文件名和页码是报告提供的定位信息，不是已完成原文件绑定的证明。
            </p>
          </section>
          <section className="card" id="chapter-review-summaries">
            <h2>12项普通摘要</h2>
            {data.summaries.map((s) => (
              <article key={s.code}>
                <h3>
                  {s.code} {s.title}
                </h3>
                <p>{s.text}</p>
                <small>
                  {s.source_id} · 物理第{s.pages}张 · 报告转述
                </small>
              </article>
            ))}
          </section>
          <section className="card" id="chapter-review-issues">
            <h2>保留的待核实事项</h2>
            {data.issues.map((i) => (
              <p key={i.code}>
                <strong>{i.code}</strong> {i.text}
              </p>
            ))}
            <h3>后续动画：本轮没有自动生成可执行动画</h3>
            {data.animations.map((a) => (
              <p key={a.code}>
                {a.code} · {a.point} · {a.title}：{a.status}
              </p>
            ))}
          </section>
          <section className="card" id="chapter-review-import">
            <h2>第一章直接应用状态</h2>
            <p>
              后端启动时自动定位唯一第一章，备份后替换并发布16项内容和RR实验。原知识点归档保留，其他章节和资料不变。K012历史代码暂缓，新的动画不冒充已完成。重复启动不会覆盖你之后的修改。无法自动定位时，可在此指定目标章。
            </p>
            <label>
              明确选择第一章所在位置
              <select
                aria-label="导入目标章节"
                value={chapter}
                onChange={(e) => {
                  setChapter(e.target.value);
                  setResult(undefined);
                }}
                disabled={busy}
              >
                <option value="">请选择目标章节</option>
                {chapters.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={!chapter || busy || result?.direct_applied}
              onClick={applyContent}
            >
              {busy ? "正在应用…" : "应用新内容并直接发布"}
            </button>
            {result && (
              <p role="status">
                {result.direct_applied
                  ? "第一章已替换并发布，无需逐条审核。旧内容已备份并归档。"
                  : "尚未应用。"}{" "}
                <Link to="/teacher/knowledge">查看当前知识点</Link> ·{" "}
                <Link
                  to={`/teacher/experiments/${result.experiment_id}/preview`}
                >
                  查看RR实验
                </Link>
              </p>
            )}
          </section>
        </>
      )}
    </AuthoringPage>
  );
}
