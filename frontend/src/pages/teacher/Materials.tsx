import { useEffect, useState, FormEvent } from "react";
import {
  teacherApi,
  api,
  documentApi,
  Material,
  Chapter,
  Knowledge,
  fileUrl,
} from "../../api";
import { Page, Notice } from "../../components";
import { useRemote, Publish, Status } from "./shared";
import {
  materialAccept,
  materialFileError,
  publicFileHint,
} from "../../materialFiles";
import PresentationPreview from "../../learning/PresentationPreview";
export default function Materials() {
  const [q, setQ] = useState("");
  const [filterChapter, setFilterChapter] = useState("");
  const [mode, setMode] = useState("active");
  const [offset, setOffset] = useState(0);
  const items = useRemote(
    () =>
      documentApi.list(true, {
        q,
        chapter_id: filterChapter ? Number(filterChapter) : undefined,
        trash: mode === "trash",
        published:
          mode === "draft" ? false : mode === "published" ? true : undefined,
        offset,
      }),
    [] as Material[],
  );
  const chapters = useRemote(teacherApi.chapters, [] as Chapter[]);
  const knowledge = useRemote(teacherApi.knowledge, [] as Knowledge[]);
  const [file, setFile] = useState<File>();
  const [uploadChapter, setUploadChapter] = useState("");
  const [selected, setSelected] = useState<Material>();
  const [title, setTitle] = useState("");
  const [editChapter, setEditChapter] = useState<number | null>(null);
  const [links, setLinks] = useState<number[]>([]);
  const [published, setPublished] = useState(false);
  const [summary, setSummary] = useState("");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [replacement, setReplacement] = useState<File>();
  const [history, setHistory] = useState<
    { id: number; original_name: string; created_at: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [success, setSuccess] = useState("");
  useEffect(() => {
    void items.refresh();
    setSelected(undefined);
  }, [q, filterChapter, mode, offset]);
  async function finish(message: string) {
    const refreshed = await items.refresh();
    setSuccess(message + (refreshed ? "" : "；列表刷新失败，请点击刷新"));
  }
  function edit(m: Material) {
    setSelected(m);
    setTitle(m.title);
    setEditChapter(m.chapter_id);
    setLinks(m.knowledge_ids || []);
    setPublished(!!m.published);
    setSummary(m.summary || "");
    setSource(m.source_title || "");
    setSourceUrl(m.source_url || "");
    setReplacement(undefined);
    setHistory([]);
    setSuccess("");
  }
  function valid(file: File) {
    const error = materialFileError(file, true);
    if (error) {
      items.setError(error);
      return false;
    }
    return true;
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !valid(file)) return;
    const form = e.currentTarget;
    setUploadProgress(0);
    setBusy(true);
    setSuccess("");
    try {
      const m = await teacherApi.uploadPublic(
        file,
        uploadChapter ? Number(uploadChapter) : null,
        setUploadProgress,
      );
      form.reset();
      setFile(undefined);
      setUploadChapter("");
      edit({ ...m, knowledge_ids: [] });
      await finish("上传已保存为草稿；设置关联并发布后学生可见");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress(undefined);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setSuccess("");
    try {
      await teacherApi.saveDocument(selected.id, {
        title,
        chapter_id: editChapter,
        knowledge_ids: links,
        published,
        summary,
        source_title: source,
        source_url: sourceUrl,
      });
      setSelected(undefined);
      await finish("资料设置已保存");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Material) {
    if (!confirm(`移入回收站“${m.title}”？学生立即不可见，可稍后恢复。`))
      return;
    setBusy(true);
    try {
      await api.deleteMaterial(m.id);
      setSelected(undefined);
      await finish("已移入回收站，原文件仍保留");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function restore(m: Material) {
    setBusy(true);
    try {
      await documentApi.restore(m.id);
      await finish("资料已恢复为草稿，请重新检查发布");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function replace(e: FormEvent) {
    e.preventDefault();
    if (!selected || !replacement || !valid(replacement)) return;
    setUploadProgress(0);
    setBusy(true);
    try {
      const m = await documentApi.replace(
        selected.id,
        replacement,
        setUploadProgress,
      );
      edit({ ...m, knowledge_ids: links });
      await finish("新版本已保存，旧文件留存；已取消发布，请检查后重新发布");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress(undefined);
    }
  }
  return (
    <Page title="公共资料管理">
      <p>
        {publicFileHint}
        。上传/替换默认为草稿，检查后发布；删除进入可恢复的回收站。
      </p>
      <Notice error={items.error || chapters.error || knowledge.error} />
      {busy && uploadProgress !== undefined && (
        <div role="status" className="upload-progress">
          <progress max="100" value={uploadProgress} />
          <span>
            {uploadProgress < 100
              ? `正在上传 ${uploadProgress}%`
              : "文件已发送，服务器正在校验并保存，请勿关闭页面…"}
          </span>
        </div>
      )}
      {success && (
        <p className="feedback" role="status">
          {success}
        </p>
      )}
      <section className="panel">
        <h2>上传公共课件与资料</h2>
        <form className="upload" onSubmit={upload}>
          <label>
            资料文件
            <input
              aria-label="公共资料文件"
              type="file"
              required
              accept={materialAccept}
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <label>
            所属章节
            <select
              aria-label="上传所属章节"
              value={uploadChapter}
              onChange={(e) => setUploadChapter(e.target.value)}
            >
              <option value="">不关联章节</option>
              {chapters.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy}>上传公共资料</button>
        </form>
      </section>
      {selected && ["ppt", "pptx"].includes(selected.file_type || "") && (
        <details
          className="teacher-presentation"
          key={selected.id + ":" + selected.sha256}
        >
          <summary>预览课件文字（原件可下载）</summary>
          <PresentationPreview material={selected} />
        </details>
      )}
      <div className="management spaced">
        <section className="panel">
          <h2>资料列表</h2>
          <div className="filters">
            <input
              aria-label="搜索公共资料"
              placeholder="搜索标题"
              maxLength={200}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
            />
            <select
              aria-label="公共资料章节筛选"
              value={filterChapter}
              onChange={(e) => {
                setFilterChapter(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">全部章节</option>
              {chapters.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
            <select
              aria-label="公共资料状态"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value);
                setOffset(0);
              }}
            >
              <option value="active">全部在用</option>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
              <option value="trash">回收站</option>
            </select>
            <button className="secondary" onClick={() => void items.refresh()}>
              刷新
            </button>
          </div>
          {items.loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>资料 / 来源</th>
                    <th>章节 / 状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((m) => (
                    <tr key={m.id}>
                      <td>
                        {m.title}
                        <small className="muted">
                          {m.file_size
                            ? ` ${(m.file_size / 1024 / 1024).toFixed(2)} MiB`
                            : ""}
                          <br />
                          {m.source_title || "未登记来源"}
                        </small>
                      </td>
                      <td>
                        {m.chapter || "未分章"}
                        <br />
                        {m.deleted_at ? (
                          "回收站"
                        ) : (
                          <Status value={m.published} />
                        )}
                      </td>
                      <td>
                        {m.deleted_at ? (
                          <button
                            disabled={busy}
                            className="secondary"
                            onClick={() => void restore(m)}
                          >
                            恢复
                          </button>
                        ) : (
                          <>
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() => edit(m)}
                            >
                              设置
                            </button>{" "}
                            {m.file_type && (
                              <a
                                className="textlink"
                                target="_blank"
                                rel="noreferrer"
                                href={fileUrl(m.id)}
                              >
                                查看
                              </a>
                            )}{" "}
                            <button
                              className="danger"
                              disabled={busy}
                              onClick={() => void remove(m)}
                            >
                              移入回收站
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.data.length && <p>没有匹配的资料</p>}
            </div>
          )}
          <div className="toolbar">
            <button
              className="secondary"
              disabled={!offset || items.loading}
              onClick={() => setOffset((v) => v - 50)}
            >
              上一页
            </button>
            <span>第{offset / 50 + 1}页</span>
            <button
              className="secondary"
              disabled={items.data.length < 50 || items.loading}
              onClick={() => setOffset((v) => v + 50)}
            >
              下一页
            </button>
          </div>
        </section>
        <section className="panel">
          <h2>章节、知识点与发布</h2>
          {selected ? (
            <>
              <form onSubmit={save}>
                <label>
                  资料标题
                  <input
                    required
                    maxLength={200}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label>
                  资料摘要
                  <textarea
                    maxLength={2000}
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                  />
                </label>
                <label>
                  来源名称
                  <input
                    maxLength={500}
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  />
                </label>
                <label>
                  来源地址
                  <input
                    type="url"
                    maxLength={1000}
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                </label>
                <label>
                  所属章节
                  <select
                    aria-label="编辑所属章节"
                    value={editChapter ?? ""}
                    onChange={(e) =>
                      setEditChapter(
                        e.target.value ? Number(e.target.value) : null,
                      )
                    }
                  >
                    <option value="">不关联章节</option>
                    {chapters.data.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>关联知识点（可多选）</legend>
                  {knowledge.data
                    .filter(
                      (k) =>
                        !editChapter ||
                        k.chapter_id === editChapter ||
                        links.includes(k.id),
                    )
                    .map((k) => (
                      <label className="check" key={k.id}>
                        <input
                          type="checkbox"
                          checked={links.includes(k.id)}
                          onChange={(e) =>
                            setLinks(
                              e.target.checked
                                ? [...links, k.id]
                                : links.filter((id) => id !== k.id),
                            )
                          }
                        />
                        {k.title}
                      </label>
                    ))}
                </fieldset>
                <Publish value={published} onChange={setPublished} />
                <button disabled={busy}>保存资料设置</button>
              </form>
              <h3>替换文件并保留旧版本</h3>
              <form onSubmit={replace}>
                <input
                  aria-label="替换公共文件"
                  type="file"
                  accept={materialAccept}
                  required
                  onChange={(e) => setReplacement(e.target.files?.[0])}
                />
                <button className="secondary" disabled={busy}>
                  保存新版本
                </button>
              </form>
              <p className="muted">
                SHA-256：{selected.sha256 || "旧资料未计算"}
                。更换文件后自动取消发布。
              </p>
              <button
                className="secondary"
                onClick={() => {
                  documentApi
                    .versions(selected.id)
                    .then(setHistory)
                    .catch((e) => items.setError(e.message));
                }}
              >
                查看版本记录
              </button>
              {history.length > 0 && (
                <ul className="versionlist">
                  {history.map((v) => (
                    <li key={v.id}>
                      {v.original_name} · {v.created_at}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>选择左侧资料进行设置；无需重新上传即可调整章节。</p>
          )}
        </section>
      </div>
    </Page>
  );
}
