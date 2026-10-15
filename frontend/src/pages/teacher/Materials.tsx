import { useState, FormEvent } from "react";
import { teacherApi, api, Material, Chapter, Knowledge } from "../../api";
import { Page, Notice } from "../../components";
import { useRemote, Publish, Status } from "./shared";
export default function Materials() {
  const items = useRemote(teacherApi.documents, [] as Material[]);
  const chapters = useRemote(teacherApi.chapters, [] as Chapter[]);
  const knowledge = useRemote(teacherApi.knowledge, [] as Knowledge[]);
  const [file, setFile] = useState<File>();
  const [chapter, setChapter] = useState<number | null>(null);
  const [selected, setSelected] = useState<Material>();
  const [title, setTitle] = useState("");
  const [links, setLinks] = useState<number[]>([]);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  function edit(m: Material) {
    setSelected(m);
    setTitle(m.title);
    setChapter(m.chapter_id);
    setLinks(m.knowledge_ids || []);
    setPublished(m.published);
    setSuccess("");
  }
  async function upload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    if (
      !/\.(pdf|txt)$/i.test(file.name) ||
      file.size === 0 ||
      file.size > 10 * 1024 * 1024
    ) {
      items.setError("请选择非空 PDF / UTF-8 TXT，最大 10 MB");
      return;
    }
    const form = e.currentTarget;
    setBusy(true);
    setSuccess("");
    try {
      const m = await teacherApi.uploadPublic(file, chapter);
      form.reset();
      setFile(undefined);
      await items.refresh();
      edit({ ...m, knowledge_ids: [] });
      setSuccess("上传完成，当前为草稿。请检查并保存发布状态。");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
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
        chapter_id: chapter,
        knowledge_ids: links,
        published,
      });
      await items.refresh();
      setSelected(undefined);
      setSuccess("资料设置已保存");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(m: Material) {
    if (!confirm(`删除公共资料“${m.title}”？`)) return;
    setBusy(true);
    setSuccess("");
    try {
      await api.deleteMaterial(m.id);
      if (selected?.id === m.id) setSelected(undefined);
      await items.refresh();
      setSuccess("公共资料已删除");
    } catch (e) {
      items.setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="公共资料管理">
      <p>
        上传默认为草稿；学生只能读取已发布课程和章节下的已发布资料。教师不读取其他用户的个人资料。
      </p>
      <Notice error={items.error || chapters.error || knowledge.error} />
      {success && (
        <p className="feedback" role="status">
          {success}
        </p>
      )}
      <section className="panel">
        <h2>上传公共 PDF / TXT</h2>
        <form className="upload" onSubmit={upload}>
          <label>
            资料文件
            <input
              aria-label="公共资料文件"
              type="file"
              required
              accept=".pdf,.txt"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </label>
          <label>
            所属章节
            <select
              aria-label="所属章节"
              value={chapter ?? ""}
              onChange={(e) =>
                setChapter(e.target.value ? Number(e.target.value) : null)
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
          <button disabled={busy}>上传公共资料</button>
        </form>
      </section>
      <div className="management spaced">
        <section className="panel">
          <h2>资料列表</h2>
          {items.loading ? (
            <p>加载中…</p>
          ) : (
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th>资料</th>
                    <th>章节 / 状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.data.map((m) => (
                    <tr key={m.id}>
                      <td>{m.title}</td>
                      <td>
                        {m.chapter || "未分章"}
                        <br />
                        <Status value={m.published} />
                      </td>
                      <td>
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
                            href={`/api/materials/${m.id}/file`}
                          >
                            查看
                          </a>
                        )}{" "}
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() => void remove(m)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.data.length && <p>暂无公共资料</p>}
            </div>
          )}
        </section>
        <section className="panel">
          <h2>章节、知识点与发布</h2>
          {selected ? (
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
                所属章节
                <select
                  aria-label="所属章节"
                  value={chapter ?? ""}
                  onChange={(e) =>
                    setChapter(e.target.value ? Number(e.target.value) : null)
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
                {knowledge.data.map((k) => (
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
          ) : (
            <p>从左侧选择一份资料，或先上传新文件。</p>
          )}
        </section>
      </div>
    </Page>
  );
}
