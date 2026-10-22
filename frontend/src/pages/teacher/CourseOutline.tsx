import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Chapter, teacherApi } from "../../api";
import { Content, digitalApi, Section } from "../../digital";
import { Notice } from "../../components";
import { AuthoringPage } from "./Authoring";
export default function CourseOutline({
  library = false,
}: {
  library?: boolean;
}) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [points, setPoints] = useState<Content[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
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
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const chapterId = Number(params.get("chapter")) || 0;
  const visible = points.filter(
    (p) =>
      !!p.archived === archived &&
      (!chapterId || p.chapter_id === chapterId) &&
      (p.title + " " + p.code).includes(search),
  );
  function rows(chapter: Chapter, section: number | null) {
    return visible
      .filter((p) => p.chapter_id === chapter.id && p.section_id === section)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((p) => (
        <div className="outline-point" key={p.id}>
          <div>
            <strong>
              {p.code?.startsWith("CH03-") ? p.title : `${p.code} ${p.title}`}
            </strong>
            <small>
              {p.published ? "已有发布版本" : "内容待编写"} ·{" "}
              {p.blocks.filter((b) => b.text.trim() || b.asset_id).length}{" "}
              个模块已填写
            </small>
          </div>
          <div className="row-actions">
            <Link className="button" to={`/teacher/knowledge/${p.id}/content`}>
              编写内容
            </Link>
            <Link to={`/teacher/knowledge/${p.id}/settings`}>
              修改标题与归属
            </Link>
            <Link to={`/teacher/knowledge/${p.id}/preview`}>预览发布</Link>
          </div>
        </div>
      ));
  }
  return (
    <AuthoringPage
      title={library ? "选择知识点，开始编写" : "先把课程目录规划好"}
      description={
        library
          ? "选中一个知识点后，进入独立编辑页。每次专注一项任务。"
          : "先建章和小节，再列出知识点标题。正文、动画和发布放在下一步处理。"
      }
    >
      <Notice error={error} />
      <div className="authoring-toolbar">
        <Link className="button" to="/teacher/chapter-content">
          查看新版第一章内容
        </Link>
        <Link
          className="button secondary"
          to="/teacher/chapter-content/chapter02"
        >
          第二章预填与审核
        </Link>
        <Link
          className="button secondary"
          to="/teacher/chapter-content/chapter04"
        >
          第四章存储管理
        </Link>
        {!library && (
          <Link className="button" to="/teacher/chapters/new">
            ＋ 新建章节
          </Link>
        )}
        <Link
          className={library ? "button" : "button secondary"}
          to={`/teacher/knowledge/new${chapterId ? "?chapter=" + chapterId : ""}`}
        >
          ＋ 添加知识点标题
        </Link>
        {library ? (
          <Link to="/teacher/chapters">返回课程目录</Link>
        ) : (
          <Link to="/teacher/knowledge">目录已规划，去编写内容 →</Link>
        )}
      </div>
      <div className="authoring-filters">
        <label>
          查看章节
          <select
            aria-label="查看章节"
            value={chapterId}
            onChange={(e) =>
              setParams(
                e.target.value === "0" ? {} : { chapter: e.target.value },
              )
            }
          >
            <option value="0">全部章节</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找知识点
          <input
            placeholder="输入编号或标题"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
        查看已归档知识点
      </label>
      {loading ? (
        <p>正在读取课程目录…</p>
      ) : (
        chapters
          .filter((c) => !chapterId || c.id === chapterId)
          .map((c) => (
            <section className="outline-chapter" key={c.id}>
              <div className="outline-chapter-header">
                <div>
                  <small>
                    课程章节 · {c.published ? "已发布" : "尚未发布"}
                  </small>
                  <h2>
                    {c.textbook_number === 4 && !/^第.*章/.test(c.title)
                      ? `第四章 ${c.title}`
                      : c.title}
                  </h2>
                </div>
                <div className="row-actions">
                  {!library && (
                    <>
                      <Link to={`/teacher/chapters/${c.id}/edit`}>
                        编辑章节
                      </Link>
                      <Link to={`/teacher/sections/new?chapter=${c.id}`}>
                        ＋ 添加小节
                      </Link>
                    </>
                  )}
                  <Link to={`/teacher/knowledge/new?chapter=${c.id}`}>
                    ＋ 添加本章标题
                  </Link>
                </div>
              </div>
              {sections
                .filter((s) => s.chapter_id === c.id)
                .sort((a, b) => a.sort_order - b.sort_order)
                .map((section) => (
                  <div className="outline-section" key={section.id}>
                    <div className="outline-section-header">
                      <h3>
                        {section.code} {section.title}
                      </h3>
                      <div className="row-actions">
                        {!library && (
                          <Link to={`/teacher/sections/${section.id}/edit`}>
                            修改小节
                          </Link>
                        )}
                        <Link
                          to={`/teacher/knowledge/new?chapter=${c.id}&section=${section.id}`}
                        >
                          ＋ 添加本节标题
                        </Link>
                      </div>
                    </div>
                    {rows(c, section.id)}
                    {!visible.some((p) => p.section_id === section.id) && (
                      <p className="outline-empty">
                        还没有知识点，先添加标题即可。
                      </p>
                    )}
                  </div>
                ))}
              {rows(c, null)}
              {!sections.some((s) => s.chapter_id === c.id) &&
                !visible.some((p) => p.chapter_id === c.id) && (
                  <p className="outline-empty">
                    这个章节还是空的。可以先添加小节，也可以直接列出知识点。
                  </p>
                )}
            </section>
          ))
      )}
      {!loading && !chapters.length && (
        <section className="authoring-card">
          <h2>从第一个章节开始</h2>
          <p>只需要一个标题，页码和正文都可以稍后补充。</p>
          <Link className="button" to="/teacher/chapters/new">
            创建第一个章节
          </Link>
        </section>
      )}
    </AuthoringPage>
  );
}
export function PlanKnowledge() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [chapter, setChapter] = useState(Number(params.get("chapter")) || 0);
  const [section, setSection] = useState(Number(params.get("section")) || 0);
  const [titles, setTitles] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([teacherApi.chapters(), digitalApi.sections()])
      .then(([cs, ss]) => {
        setChapters(cs);
        setSections(ss);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const lines = titles
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length || lines.length > 30) {
      setError("请填写1–30个标题，每行一个。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = await digitalApi.planTitles(
        chapter,
        section || null,
        lines,
      );
      navigate(
        created.length === 1
          ? `/teacher/knowledge/${created[0].id}/settings`
          : `/teacher/chapters?chapter=${chapter}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthoringPage
      title="先列出知识点标题"
      description="现在不用写正文。把一章或一节的标题列好，以后再逐个补内容。"
      back={{ to: "/teacher/chapters", label: "返回课程目录" }}
    >
      <Notice error={error} />
      <form className="authoring-card authoring-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            所属章节
            <select
              aria-label="所属章节"
              required
              value={chapter || ""}
              onChange={(e) => {
                setChapter(Number(e.target.value));
                setSection(0);
              }}
            >
              <option value="">选择一个章节</option>
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
              value={section}
              onChange={(e) => setSection(Number(e.target.value))}
            >
              <option value="0">暂不分节</option>
              {sections
                .filter((s) => s.chapter_id === chapter)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} {s.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            知识点标题
            <textarea
              aria-label="知识点标题"
              required
              maxLength={6030}
              rows={10}
              value={titles}
              placeholder={
                "操作系统是什么\n从四个角度理解操作系统\n操作系统的目标"
              }
              onChange={(e) => setTitles(e.target.value)}
            />
          </label>
          <p className="field-help">
            每行一个标题，一次最多30个。创建后都是草稿，不会直接出现在学生端。
          </p>
          <div className="authoring-actions">
            <button disabled={busy}>
              {busy ? "正在创建…" : "保存标题，建立目录"}
            </button>
            <Link to="/teacher/chapters">取消，返回目录</Link>
          </div>
        </fieldset>
      </form>
    </AuthoringPage>
  );
}
