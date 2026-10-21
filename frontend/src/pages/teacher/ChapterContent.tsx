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
  already_imported: boolean;
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
    ])
      .then(([p, c]) => {
        setData(p);
        setChapters(c);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function importDrafts() {
    setError("");
    setBusy(true);
    try {
      setResult(
        await request<Result>("/teacher/chapter-content/chapter01/import", {
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
      title="第一章内容审核"
      description="内容已填写。先阅读，确认后保存为草稿；不会自动向学生发布。"
      back={{ to: "/teacher/knowledge", label: "返回知识点管理" }}
    >
      <Notice error={error} />
      {!data && !error && <p>正在加载已填写内容…</p>}
      {data && (
        <>
          <p className="notice">{data.notice}</p>
          <nav className="chapter-review-nav" aria-label="内容审核导航">
            <a href="#chapter-review-content">知识卡与图示</a>
            <a href="#chapter-review-sources">来源</a>
            <a href="#chapter-review-summaries">普通摘要</a>
            <a href="#chapter-review-issues">待核实与后续动画</a>
            <a href="#chapter-review-import">保存草稿</a>
          </nav>
          <section id="chapter-review-content" className="card">
            <h2>已填写的知识卡与图示</h2>
            <label>
              选择审核内容
              <select
                aria-label="选择审核内容"
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
                    ? "将导入为待审核草稿"
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
                    emphasis: "待你审核",
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
                    打开已保存草稿进行审核发布
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
            <h2>将已填写内容保存到数据库草稿</h2>
            <p>
              保存15项知识内容（含第二批静态草稿、辅助图）及普通摘要、1个RR实验草稿；K012旧Linux实现暂缓。不会覆盖原知识点，不自动发布课程、小节或内容。相同内容包重复操作不会重复创建。
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
            <button disabled={!chapter || busy} onClick={importDrafts}>
              {busy ? "正在保存…" : "保存已填写内容为待审核草稿"}
            </button>
            {result && (
              <p role="status">
                {result.already_imported
                  ? "该内容包已保存，本次没有覆盖或重复创建。"
                  : "草稿已保存。"}{" "}
                <Link to="/teacher/knowledge">查看知识点草稿</Link> ·{" "}
                <Link
                  to={`/teacher/experiments/${result.experiment_id}/preview`}
                >
                  审核RR实验
                </Link>
              </p>
            )}
          </section>
        </>
      )}
    </AuthoringPage>
  );
}
