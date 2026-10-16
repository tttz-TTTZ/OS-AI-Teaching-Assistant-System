import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fileUrl } from "../api";
import { Content, digitalApi, Progress, Section } from "../digital";
import { Page, Notice, useChapters } from "../components";
import { useAuth } from "../auth";
import ContentView from "../learning/ContentView";
import { studyApi } from "../study";

export default function Knowledge() {
  const { chapters, error } = useChapters();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const chapter = Number(params.get("chapter")) || chapters[0]?.id;
  const requested = Number(params.get("point"));
  const [items, setItems] = useState<Content[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [detail, setDetail] = useState<Content>();
  const [progress, setProgress] = useState<Progress>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [dirty, setDirty] = useState(false);
  const [font, setFont] = useState(17);
  const [feedback, setFeedback] = useState("");
  useEffect(() => {
    if (requested && !params.get("chapter")) {
      digitalApi
        .detail(requested)
        .then((p) =>
          setParams({
            chapter: String(p.chapter_id),
            point: String(requested),
          }),
        )
        .catch((e) => setFailure(e.message));
      return;
    }
    let active = true;
    setDetail(undefined);
    setProgress(undefined);
    setFailure("");
    setMessage("");
    if (!chapter) return;
    setLoading(true);
    Promise.all([digitalApi.list(chapter), digitalApi.sections(chapter)])
      .then(async ([list, secs]) => {
        if (!active) return;
        setItems(list);
        setSections(secs);
        const point = requested
          ? list.find((p) => p.id === requested)
          : list[0];
        if (requested && !point)
          setFailure("该知识点不存在、已撤回或不属于当前章节");
        if (point?.id) {
          const [d, p] = await Promise.all([
            digitalApi.detail(point.id),
            digitalApi.progress(point.id),
          ]);
          if (!active) return;
          setDetail(d);
          setProgress(p);
          setDirty(false);
          if (user)
            sessionStorage.setItem(
              `os:last:${user.id}`,
              JSON.stringify({
                chapter: d.chapter_id,
                point: d.id,
                title: d.title,
              }),
            );
          const anchor = params.get("block") || p.position;
          if (anchor)
            setTimeout(() => {
              if (active)
                document
                  .getElementById("block-" + anchor)
                  ?.scrollIntoView({ block: "start" });
            }, 0);
        }
      })
      .catch((e) => {
        if (active) setFailure(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chapter, requested, user?.id]);
  async function save() {
    if (!detail?.id || !progress) return;
    setSaving(true);
    setMessage("保存中…");
    setFailure("");
    try {
      const result = await digitalApi.saveProgress(detail.id, progress);
      setProgress((p) => (p ? { ...p, version: result.version } : p));
      setMessage("学习记录已保存");
      setDirty(false);
    } catch (e) {
      setMessage("尚未同步，请保留当前页面后重试");
      setFailure((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function changeProgress(patch: Partial<Progress>) {
    setProgress((p) => (p ? { ...p, ...patch } : p));
    setDirty(true);
  }
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  function choose(point: Content) {
    if (dirty && !confirm("学习记录尚未保存，确定切换？")) return;
    setParams({ chapter: String(point.chapter_id), point: String(point.id) });
  }
  const index = items.findIndex((p) => p.id === detail?.id);
  const visible = items.filter((p) =>
    (p.code + " " + p.title + " " + p.summary).includes(query),
  );
  const pointButtons = (sectionId: number | null) => (
    <>
      {visible
        .filter((p) => p.section_id === sectionId)
        .map((p) => (
          <button
            key={p.id}
            className={"point " + (detail?.id === p.id ? "selected" : "")}
            onClick={() => choose(p)}
          >
            {p.code} {p.title}
          </button>
        ))}
    </>
  );
  return (
    <Page title="知识点学习">
      <Notice error={error || failure} />
      <div className="reading digital-reading">
        <aside className="panel chaptertree">
          <h2>课程目录</h2>
          <input
            aria-label="搜索本章知识点"
            placeholder="搜索本章标题/摘要"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {chapters.map((c) => (
            <div key={c.id}>
              <button
                className={"chapter " + (c.id === chapter ? "selected" : "")}
                onClick={() => {
                  if (!dirty || confirm("学习记录尚未保存，确定切换？"))
                    setParams({ chapter: String(c.id) });
                }}
              >
                {c.title}
              </button>
              {c.id === chapter && (
                <>
                  {sections.map((s) => (
                    <details key={s.id} open>
                      <summary>
                        {s.code} {s.title}
                      </summary>
                      {pointButtons(s.id)}
                    </details>
                  ))}
                  {pointButtons(null)}
                </>
              )}
            </div>
          ))}
          {!chapters.length && <p>暂无已发布章节</p>}
        </aside>
        <section className="panel readingbody" style={{ fontSize: font }}>
          {loading ? (
            <p>正在加载教材…</p>
          ) : detail ? (
            <>
              <div className="toolbar">
                <small>发布修订 #{detail.revision_id || "旧版"}</small>
                <label>
                  字号
                  <select
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
              </div>
              {progress?.has_previous_version && (
                <p className="notice">
                  内容已更新。旧版学习记录保留，建议阅读本版后重新标记。
                </p>
              )}
              <ContentView
                key={detail.id + "-" + detail.revision_id}
                content={detail}
                onPosition={(id) =>
                  setProgress((p) => (p ? { ...p, position: id } : p))
                }
                onComplete={() =>
                  digitalApi
                    .progress(detail.id!)
                    .then((remote) =>
                      setProgress((p) =>
                        p
                          ? {
                              ...p,
                              completed_blocks: remote.completed_blocks,
                              practice_completed: remote.practice_completed,
                            }
                          : remote,
                      ),
                    )
                    .catch((e) => setFailure(e.message))
                }
              />
              <div className="toolbar spaced">
                <Link
                  className="button"
                  to={`/student/practice?chapter=${detail.chapter_id}&knowledge=${detail.id}&block=${progress?.position || ""}`}
                >
                  练习本知识点 →
                </Link>
                {index > 0 && (
                  <button
                    className="secondary"
                    onClick={() => choose(items[index - 1])}
                  >
                    上一个知识点
                  </button>
                )}
                {index >= 0 && index < items.length - 1 && (
                  <button
                    className="secondary"
                    onClick={() => choose(items[index + 1])}
                  >
                    下一个知识点
                  </button>
                )}
              </div>
            </>
          ) : (
            <p>本章暂无已发布知识点。</p>
          )}
        </section>
        <aside className="panel readinglinks">
          <h2>本页学习指引</h2>
          {detail?.blocks.map((b) => (
            <a
              key={b.id}
              className="textlink"
              href={"#block-" + b.id}
              onClick={() =>
                setProgress((p) => (p ? { ...p, position: b.id } : p))
              }
            >
              {b.title || "学习内容"}
            </a>
          ))}
          {progress && (
            <section className="progress-editor">
              <fieldset disabled={saving}>
                <h3>我的学习记录</h3>
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
                <p>
                  互动：
                  {detail?.blocks.some((b) => b.kind === "interaction")
                    ? `${progress.completed_blocks?.length || 0} 项已完成观察`
                    : "不适用"}
                </p>
                <p>
                  练习：
                  {progress.practice_completed ? "已完成作答" : "尚未记录作答"}
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!progress.self_assessed}
                    onChange={(e) =>
                      changeProgress({ self_assessed: e.target.checked })
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
                <label>
                  私人学习笔记
                  <textarea
                    aria-label="私人学习笔记"
                    maxLength={5000}
                    value={progress.note}
                    onChange={(e) => changeProgress({ note: e.target.value })}
                  />
                </label>
                <button disabled={saving} onClick={save}>
                  保存学习记录
                </button>
                {message && <p role="status">{message}</p>}
                <small>
                  笔记仅本人可见。阅读位置、标记与笔记点击保存后写入数据库。
                </small>
              </fieldset>
            </section>
          )}
          {detail?.id && (
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
              <p>此处会发送给教师；上方私人笔记不会发送。</p>
              <button
                disabled={saving || !feedback.trim()}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await studyApi.feedback(detail.id!, feedback);
                    setFeedback("");
                    setMessage("反馈已发送给教师");
                  } catch (e) {
                    setFailure((e as Error).message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                发送学习反馈
              </button>
            </details>
          )}
          <h3>相关资料</h3>
          {detail?.materials?.map((m) => (
            <div className="resource" key={m.id}>
              <Link to={`/student/materials?document=${m.id}`}>
                {m.title} →
              </Link>
              {m.file_type && (
                <a
                  className="textlink"
                  href={fileUrl(m.id)}
                  target="_blank"
                  rel="noreferrer"
                >
                  打开文件
                </a>
              )}
            </div>
          ))}
          {!detail?.materials?.length && <p>暂无关联资料</p>}
          <h3>知识关联</h3>
          {detail?.related?.map((p) => (
            <Link
              className="textlink"
              key={p.id}
              to={`/student/knowledge?chapter=${p.chapter_id}&point=${p.id}`}
            >
              {p.title}
            </Link>
          ))}
          {detail?.lab && (
            <Link className="button" to="/student/experiments">
              运行 FCFS →
            </Link>
          )}
          <h3>巩固练习</h3>
          <Link to={`/student/practice?chapter=${chapter || ""}`}>
            进入章节练习 →
          </Link>
        </aside>
      </div>
    </Page>
  );
}
