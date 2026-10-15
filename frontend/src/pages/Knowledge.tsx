import { fileUrl } from "../api";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { courseApi, Knowledge as Item } from "../api";
import { Page, Notice, useChapters } from "../components";
import { useAuth } from "../auth";
import Markdown from "../Markdown";
export default function Knowledge() {
  const { chapters, error } = useChapters();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const chapter = Number(params.get("chapter")) || chapters[0]?.id;
  const requested = Number(params.get("point"));
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Item>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setItems([]);
    setFailure("");
    if (!chapter) return;
    setLoading(true);
    courseApi
      .knowledge(chapter)
      .then(async (list) => {
        if (!active) return;
        setItems(list);
        const item = list.find((k) => k.id === requested) || list[0];
        if (item) {
          const d = await courseApi.detail(item.id);
          if (active) {
            setDetail(d);
            if (user)
              sessionStorage.setItem(
                `os:last:${user.id}`,
                JSON.stringify({
                  chapter: d.chapter_id,
                  point: d.id,
                  title: d.title,
                }),
              );
          }
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
  return (
    <Page title="知识点学习">
      <Notice error={error || failure} />
      <div className="reading">
        <aside className="panel chaptertree">
          <h2>课程目录</h2>
          {chapters.map((c) => (
            <div key={c.id}>
              <button
                className={`chapter ${c.id === chapter ? "selected" : ""}`}
                onClick={() => setParams({ chapter: String(c.id) })}
              >
                {c.title}
              </button>
              {c.id === chapter &&
                items.map((k) => (
                  <button
                    className={`point ${detail?.id === k.id ? "selected" : ""}`}
                    key={k.id}
                    onClick={() =>
                      setParams({ chapter: String(c.id), point: String(k.id) })
                    }
                  >
                    {k.title}
                  </button>
                ))}
            </div>
          ))}
          {!chapters.length && <p>暂无已发布章节</p>}
        </aside>
        <section className="panel readingbody">
          {loading ? (
            <p>加载中…</p>
          ) : detail ? (
            <>
              <span className="badge">课程知识点</span>
              <h2>{detail.title}</h2>
              <Markdown content={detail.content} />
            </>
          ) : (
            <p className="empty">本章暂无已发布知识点。</p>
          )}
        </section>
        <section className="panel readinglinks">
          <h2>关联学习</h2>
          <h3>相关资料</h3>
          {detail?.materials?.length ? (
            detail.materials.map((m) => (
              <div className="resource" key={m.id}>
                <Link
                  className="textlink"
                  to={`/student/materials?document=${m.id}`}
                >
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
            ))
          ) : (
            <p>暂无关联资料</p>
          )}
          {detail?.lab_path && (
            <>
              <h3>动手实验</h3>
              <Link className="button" to="/student/experiments">
                运行 FCFS →
              </Link>
            </>
          )}
          <h3>巩固练习</h3>
          <Link
            className="textlink"
            to={`/student/practice?chapter=${chapter || ""}`}
          >
            进入章节练习 →
          </Link>
        </section>
      </div>
    </Page>
  );
}
