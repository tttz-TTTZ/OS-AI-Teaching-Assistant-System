import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { courseApi, Knowledge as Item } from "../api";
import { Page, Notice, useChapters, ChapterSelect } from "../components";
export default function Knowledge() {
  const { chapters, error } = useChapters();
  const [params, setParams] = useSearchParams();
  const chapter = Number(params.get("chapter")) || 1;
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Item>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setDetail(undefined);
    setLoading(true);
    setFailure("");
    courseApi
      .knowledge(chapter)
      .then(async (list) => {
        if (!active) return;
        setItems(list);
        if (list[0]) {
          const d = await courseApi.detail(list[0].id);
          if (active) setDetail(d);
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
  }, [chapter]);
  async function select(id: number) {
    try {
      setDetail(await courseApi.detail(id));
    } catch (e) {
      setFailure((e as Error).message);
    }
  }
  return (
    <Page title="知识点学习">
      <section className="panel">
        <ChapterSelect
          value={chapter}
          onChange={(id) => setParams({ chapter: String(id) })}
          chapters={chapters}
        />
        <p>人工整理示例内容，可在后端课程数据中按教材扩展。</p>
      </section>
      <Notice error={error || failure} />
      {loading ? (
        <p>加载中…</p>
      ) : (
        <div className="split spaced">
          <section className="panel">
            <h2>知识点目录</h2>
            {items.map((i) => (
              <button
                className="topic"
                key={i.id}
                onClick={() => void select(i.id)}
              >
                {i.title} →
              </button>
            ))}
            {!items.length && <p>该章节暂无知识点</p>}
          </section>
          <section className="panel">
            <h2>{detail?.title || "选择知识点"}</h2>
            <p className="bodytext">{detail?.content}</p>
            {detail && (
              <>
                <h3>相关资料</h3>
                {detail.materials?.length ? (
                  detail.materials.map((m) => (
                    <p key={m.id}>
                      <Link className="textlink" to="/materials">
                        {m.title} → 资料页
                      </Link>
                    </p>
                  ))
                ) : (
                  <p>暂无关联资料，可在资料页按本章节上传。</p>
                )}
                {detail.lab_path && (
                  <Link className="button" to={detail.lab_path}>
                    进入 FCFS 实验 →
                  </Link>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}
