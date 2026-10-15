import { fileUrl } from "../api";
import { useSearchParams } from "react-router-dom";
import { useEffect, useState, FormEvent } from "react";
import { api, courseApi, Material, documentApi } from "../api";
import { Page, Notice, useChapters } from "../components";
export default function Materials() {
  const [params] = useSearchParams();
  const documentId = Number(params.get("document"));
  useEffect(() => {
    if (documentId)
      api
        .material(documentId)
        .then(setView)
        .catch((e) => setError(e.message));
  }, [documentId]);
  const [q, setQ] = useState("");
  const [trash, setTrash] = useState(false);
  const [items, setItems] = useState<Material[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("all");
  const [offset, setOffset] = useState(0);
  const [file, setFile] = useState<File>();
  const [chapter, setChapter] = useState("");
  const [view, setView] = useState<Material>();
  const { chapters, error: chapterError } = useChapters();
  async function refresh() {
    setLoading(true);
    try {
      setError("");
      setItems(
        await documentApi.list(false, {
          q,
          trash,
          offset,
          category: category === "all" ? undefined : category,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [offset, category, q, trash]);
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setError("");
    if (
      !/\.(pdf|txt)$/i.test(file.name) ||
      file.size > 10 * 1024 * 1024 ||
      !file.size
    ) {
      setError("请选择非空 PDF 或 UTF-8 TXT，最大 10 MB");
      return;
    }
    setBusy(true);
    const form = e.currentTarget;
    try {
      await courseApi.upload(file, chapter);
      setFile(undefined);
      form.reset();
      setChapter("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Material) {
    if (!confirm(`移入回收站“${m.title}”？原文件保留，可恢复。`)) return;
    setBusy(true);
    try {
      await api.deleteMaterial(m.id);
      if (view?.id === m.id) setView(undefined);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="课程资料">
      <p className="hint">
        公共资料由教师发布；个人资料仅本人可读取、下载和删除。文件仅用于可信本地学习。
      </p>
      <section className="panel">
        <h2>上传个人资料</h2>
        <form onSubmit={upload} className="upload">
          <label>
            文件（PDF / UTF-8 TXT，≤10 MB）
            <input
              aria-label="上传资料"
              type="file"
              accept=".pdf,.txt"
              required
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <label>
            关联章节
            <select
              value={chapter}
              onChange={(e) => setChapter(e.target.value)}
            >
              <option value="">未分章</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>{busy ? "处理中…" : "上传资料"}</button>
        </form>
      </section>
      <Notice error={error || chapterError} />
      <section className="panel spaced">
        <div className="filters">
          <input
            aria-label="搜索资料"
            placeholder="按标题搜索"
            value={q}
            maxLength={200}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={trash}
              onChange={(e) => {
                setTrash(e.target.checked);
                setOffset(0);
                setView(undefined);
              }}
            />
            本人的回收站
          </label>
        </div>
        <div className="toolbar">
          <h2>资料列表</h2>
          <select
            aria-label="资料分类"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setOffset(0);
            }}
          >
            <option value="all">全部资料</option>
            <option value="public">公共资料</option>
            <option value="personal">个人资料</option>
          </select>
          <button className="secondary" onClick={() => void refresh()}>
            刷新
          </button>
        </div>
        {loading ? (
          <p>加载中…</p>
        ) : (
          <>
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>资料</th>
                    <th>类别 / 章节</th>
                    <th>类型 / 大小</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter(
                      (i) => category === "all" || i.category === category,
                    )
                    .map((m) => (
                      <tr key={m.id}>
                        <td>{m.title}</td>
                        <td>
                          {m.category === "public" ? "公共" : "个人"} /{" "}
                          {m.chapter || "未分章"}
                        </td>
                        <td>
                          {m.file_type?.toUpperCase() || "文本"}{" "}
                          {m.file_size
                            ? `${(m.file_size / 1024).toFixed(1)} KB`
                            : ""}
                        </td>
                        <td>
                          {m.deleted_at && (
                            <button
                              className="secondary"
                              onClick={() => {
                                documentApi
                                  .restore(m.id)
                                  .then(() => refresh())
                                  .catch((e) => setError(e.message));
                              }}
                            >
                              恢复
                            </button>
                          )}
                          <button
                            disabled={!!m.deleted_at}
                            className="secondary"
                            onClick={() => {
                              api
                                .material(m.id)
                                .then(setView)
                                .catch((e) => setError(e.message));
                            }}
                          >
                            详情
                          </button>{" "}
                          {m.file_type && !m.deleted_at && (
                            <>
                              <a
                                className="textlink"
                                href={fileUrl(m.id)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                查看
                              </a>{" "}
                              <a
                                className="textlink"
                                href={fileUrl(m.id, true)}
                              >
                                下载
                              </a>
                            </>
                          )}{" "}
                          {m.category === "personal" && !m.deleted_at && (
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => void remove(m)}
                            >
                              移入回收站
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!items.filter((i) => category === "all" || i.category === category)
              .length && <p className="empty">暂无资料</p>}
          </>
        )}
        <div className="toolbar">
          <button
            className="secondary"
            disabled={loading || offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - 50))}
          >
            上一页
          </button>
          <span>第 {offset / 50 + 1} 页</span>
          <button
            className="secondary"
            disabled={loading || items.length < 50}
            onClick={() => setOffset((o) => o + 50)}
          >
            下一页
          </button>
        </div>
      </section>
      {view && (
        <section className="panel spaced">
          <div className="toolbar">
            <h2>{view.title}</h2>
            <button className="secondary" onClick={() => setView(undefined)}>
              关闭详情
            </button>
          </div>
          <pre>
            {view.content || "此文件未提取正文，请点击列表中的查看或下载。"}
          </pre>
        </section>
      )}
    </Page>
  );
}
