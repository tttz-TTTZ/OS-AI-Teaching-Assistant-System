import { FormEvent, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ChapterInput, teacherApi } from "../../api";
import { digitalApi, Section } from "../../digital";
import { Notice } from "../../components";
import { AuthoringPage } from "./Authoring";
export default function ChapterForm() {
  const { chapterId } = useParams();
  const id = Number(chapterId) || undefined;
  const navigate = useNavigate();
  const [form, setForm] = useState<ChapterInput>({
    title: "",
    description: "",
    course_id: 1,
    sort_order: 10,
    published: false,
  });
  const [loading, setLoading] = useState(!!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    let active = true;
    teacherApi
      .chapters()
      .then((cs) => {
        if (!active) return;
        const found = cs.find((c) => c.id === id);
        if (!found) throw Error("章节不存在");
        setForm(found);
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
  }, [id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const c = await teacherApi.saveChapter(form, id);
      navigate(`/teacher/chapters?chapter=${c.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthoringPage
      title={id ? "编辑这个章节" : "创建一个章节"}
      description="先确定标题和顺序，页码可以以后校对。这里仅处理章节信息。"
      back={{ to: "/teacher/chapters", label: "返回课程目录" }}
    >
      <Notice error={error} />
      {loading ? (
        <p>正在读取章节…</p>
      ) : (
        <form className="authoring-card authoring-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <label>
              章节标题
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              章节说明
              <textarea
                aria-label="章节说明"
                rows={4}
                maxLength={5000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <label>
              排列顺序
              <input
                type="number"
                required
                min={0}
                max={100000}
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
              />
              <small>数字越小越靠前，之后仍能修改。</small>
            </label>
            <details className="optional-fields">
              <summary>补充教材章号与页码（可以稍后填写）</summary>
              {(
                [
                  ["textbook_number", "教材章号"],
                  ["pdf_start", "章节PDF起始页"],
                  ["pdf_end", "章节PDF末页"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    min={1}
                    type="number"
                    value={form[key] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [key]: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
              ))}
            </details>
            <label className="check">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) =>
                  setForm({ ...form, published: e.target.checked })
                }
              />
              发布给学生（章内知识点仍需分别发布）
            </label>
            <div className="authoring-actions">
              <button disabled={busy}>保存章节</button>
              <Link to="/teacher/chapters">取消</Link>
            </div>
            {id && (
              <details className="optional-fields">
                <summary>删除空章节</summary>
                <p>只有没有小节、知识点、题目和资料的空章节才允许删除。</p>
                <button
                  type="button"
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm("确定删除这个空章节？")) return;
                    setBusy(true);
                    try {
                      await teacherApi.deleteChapter(id);
                      navigate("/teacher/chapters");
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy(false);
                    }
                  }}
                >
                  删除这个空章节
                </button>
              </details>
            )}
          </fieldset>
        </form>
      )}
    </AuthoringPage>
  );
}
export function SectionForm() {
  const { sectionId } = useParams();
  const id = Number(sectionId) || undefined;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [chapters, setChapters] = useState<
    Awaited<ReturnType<typeof teacherApi.chapters>>
  >([]);
  const [form, setForm] = useState<Omit<Section, "id">>({
    chapter_id: Number(params.get("chapter")) || 0,
    title: "",
    code: "",
    sort_order: 10,
    published: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([teacherApi.chapters(), digitalApi.sections()])
      .then(([cs, ss]) => {
        if (!active) return;
        setChapters(cs);
        if (id) {
          const found = ss.find((s) => s.id === id);
          if (!found) throw Error("小节不存在");
          setForm(found);
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
  }, [id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await digitalApi.saveSection(form, id);
      navigate(`/teacher/chapters?chapter=${form.chapter_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthoringPage
      title={id ? "修改小节" : "为章节添加小节"}
      description="小节只是组织目录，知识点正文在下一步填写。"
      back={{ to: "/teacher/chapters", label: "返回课程目录" }}
    >
      <Notice error={error} />
      {loading ? (
        <p>正在读取目录…</p>
      ) : (
        <form className="authoring-card authoring-form" onSubmit={save}>
          <fieldset disabled={busy}>
            <label>
              小节所属章
              <select
                aria-label="小节所属章"
                required
                disabled={!!id}
                value={form.chapter_id || ""}
                onChange={(e) =>
                  setForm({ ...form, chapter_id: Number(e.target.value) })
                }
              >
                <option value="">选择章节</option>
                {chapters.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              小节标题
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label>
              小节编号
              <input
                maxLength={80}
                placeholder="例如1.1，也可以留空"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </label>
            <label>
              排列顺序
              <input
                type="number"
                min={0}
                max={100000}
                value={form.sort_order}
                onChange={(e) =>
                  setForm({ ...form, sort_order: Number(e.target.value) })
                }
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(e) =>
                  setForm({ ...form, published: e.target.checked })
                }
              />
              发布小节
            </label>
            <div className="authoring-actions">
              <button disabled={busy}>保存小节</button>
              <Link to="/teacher/chapters">取消</Link>
            </div>
          </fieldset>
        </form>
      )}
    </AuthoringPage>
  );
}
