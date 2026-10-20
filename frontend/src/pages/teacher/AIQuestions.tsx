import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Chapter,
  Material,
  documentApi,
  teacherApi,
  courseApi,
} from "../../api";
import { Content, digitalApi } from "../../digital";
import { StudyQuestion, typeNames } from "../../study";
import {
  aiQuestionApi,
  AIJob,
  AIJobSummary,
  SourcePick,
  SourcePreview,
} from "../../aiQuestions";
import { Notice } from "../../components";
import { materialAccept, materialFileError } from "../../materialFiles";
import { AuthoringPage } from "./Authoring";
export default function AIQuestions() {
  const [params, setParams] = useSearchParams();
  const step = params.get("step") || "sources";
  const jobId = Number(params.get("job"));
  const [status, setStatus] = useState<{
    configured: boolean;
    model: string;
  }>();
  const [jobs, setJobs] = useState<AIJobSummary[]>([]);
  const [job, setJob] = useState<AIJob>();
  const [documents, setDocuments] = useState<Material[]>([]);
  const [selected, setSelected] = useState<SourcePick[]>([]);
  const [chosen, setChosen] = useState<Record<number, Material>>({});
  const [mode, setMode] = useState("public");
  const [search, setSearch] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [points, setPoints] = useState<Content[]>([]);
  const [preview, setPreview] = useState<SourcePreview>();
  const [chapter, setChapter] = useState(0);
  const [knowledge, setKnowledge] = useState<number[]>([]);
  const [kinds, setKinds] = useState<StudyQuestion["kind"][]>(["single"]);
  const [count, setCount] = useState(5);
  const [difficulty, setDifficulty] = useState("basic");
  const [focus, setFocus] = useState("");
  const [file, setFile] = useState<File>();
  const [uploadProgress, setUploadProgress] = useState<number>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestKey = useRef("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function refreshJobs() {
    return aiQuestionApi.jobs().then(setJobs);
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      aiQuestionApi.status(),
      aiQuestionApi.jobs(),
      teacherApi.chapters(),
      digitalApi.teacherList(),
    ])
      .then(([s, js, cs, ps]) => {
        if (active) {
          setStatus(s);
          setJobs(js);
          setChapters(cs);
          setPoints(ps);
          setChapter(cs[0]?.id || 0);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        documentApi
          .list(mode === "public", { category: mode, q: search })
          .then((rows) => {
            if (active) setDocuments(rows);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, search]);
  useEffect(() => {
    let active = true;
    setJob(undefined);
    if (jobId)
      aiQuestionApi
        .job(jobId)
        .then((value) => {
          if (active) setJob(value);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [jobId]);
  function go(next: string, id?: number) {
    setParams({ step: next, ...(id ? { job: String(id) } : {}) });
    window.scrollTo(0, 0);
  }
  function updateSources(next: SourcePick[]) {
    setSelected(next);
    setPreview(undefined);
    requestKey.current = "";
    setMessage("");
  }
  async function upload() {
    if (!file) return;
    const failure = materialFileError(file);
    if (failure) {
      setError(failure);
      return;
    }
    setBusy(true);
    setError("");
    setUploadProgress(0);
    try {
      const d = await courseApi.upload(file, "", setUploadProgress);
      setChosen((p) => ({ ...p, [d.id]: d }));
      if (selected.length < 5)
        updateSources([
          ...selected,
          {
            document_id: d.id,
            start_page: 1,
            end_page: d.file_type === "pptx" ? 10 : 1,
          },
        ]);
      setMode("personal");
      setDocuments((ds) => [d, ...ds]);
      setMessage("已保存为你的出题专用资料，不会自动作为公共资料发布。");
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setUploadProgress(undefined);
    }
  }
  async function readSources() {
    setBusy(true);
    setError("");
    try {
      setPreview(await aiQuestionApi.preview(selected));
      requestKey.current = "";
      setMessage("摘录已读取，请先核对下方文字。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!preview || !chapter || !kinds.length) return;
    setBusy(true);
    setError("");
    setMessage(
      "正在请求DeepSeek，通常需要数十秒。请勿重复点击；服务可能计费。",
    );
    requestKey.current ||= crypto.randomUUID();
    try {
      const result = await aiQuestionApi.generate({
        sources: selected,
        chapter_id: chapter,
        knowledge_ids: knowledge,
        kinds,
        count,
        difficulty,
        focus,
        fingerprint: preview.fingerprint,
        request_key: requestKey.current,
      });
      if (!alive.current) return;
      setJob(result);
      await refreshJobs();
      if (!alive.current) return;
      go("review", result.id);
      setMessage(
        result.status === "succeeded"
          ? "生成结果已保存。候选题尚未进入学生题库，请逐题核对。"
          : "已恢复本次任务状态，请查看记录，不要重复生成。",
      );
    } catch (e) {
      setError((e as Error).message);
      requestKey.current = "";
      await refreshJobs().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function reloadJob() {
    if (!jobId) return;
    try {
      setJob(await aiQuestionApi.job(jobId));
      await refreshJobs();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <AuthoringPage
      title="AI辅助出题"
      description="选资料、核对摘录、生成候选，最后由教师审核。生成不等于发布。"
      back={{ to: "/teacher/questions", label: "返回课程题库" }}
    >
      <nav className="authoring-steps" aria-label="AI出题步骤">
        {[
          ["sources", "选择与预览资料"],
          ["generate", "设置并生成"],
          ["review", "审核候选题"],
        ].map(([key, label], i) => (
          <button
            key={key}
            className={step === key ? "current" : ""}
            disabled={
              busy ||
              (key === "generate" && !preview) ||
              (key === "review" && !jobId)
            }
            onClick={() => go(key, key === "review" ? jobId : undefined)}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <Notice error={error} />
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      {status && !status.configured && (
        <p className="notice">
          尚未配置DeepSeek密钥。可以先准备资料和预览摘录；在后端.env设置DEEPSEEK_API_KEY并重启后才可真实生成。
        </p>
      )}
      <fieldset className="authoring-editor" disabled={busy}>
        {step === "sources" && (
          <>
            <section className="authoring-card authoring-form">
              <h2>从哪里取出题依据？</h2>
              <div className="toolbar">
                <button
                  className={mode === "public" ? "" : "secondary"}
                  onClick={() => setMode("public")}
                >
                  公共课程资料
                </button>
                <button
                  className={mode === "personal" ? "" : "secondary"}
                  onClick={() => setMode("personal")}
                >
                  我的出题专用资料
                </button>
              </div>
              <label>
                查找资料
                <input
                  aria-label="查找出题资料"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="输入标题；每次显示最多50份，可搜索其他资料"
                />
              </label>
              <p>
                可选择最多5份。TXT、文字PDF、PPTX可用；旧PPT请另存为PPTX。扫描图片需先OCR。不会自动读取整个400页课件。
              </p>
              <div className="ai-source-list">
                {documents.map((d) => (
                  <label className="check" key={d.id}>
                    <input
                      type="checkbox"
                      checked={selected.some((s) => s.document_id === d.id)}
                      disabled={
                        selected.length >= 5 &&
                        !selected.some((s) => s.document_id === d.id)
                      }
                      onChange={(e) => {
                        setChosen((p) => ({ ...p, [d.id]: d }));
                        updateSources(
                          e.target.checked
                            ? [
                                ...selected,
                                {
                                  document_id: d.id,
                                  start_page: 1,
                                  end_page: d.file_type === "pptx" ? 10 : 1,
                                },
                              ]
                            : selected.filter((s) => s.document_id !== d.id),
                        );
                      }}
                    />
                    {d.title} · {d.file_type?.toUpperCase() || "文本"}{" "}
                    {d.published ? "" : "（未发布）"}
                  </label>
                ))}
              </div>
              {!documents.length && <p>没有匹配资料，可搜索或在下方上传。</p>}
            </section>
            <section className="authoring-card authoring-form">
              <h2>为出题单独上传资料</h2>
              <p>
                上传到你的个人资料，学生和其他教师不能读取原件。题目审核后可以发布，但原件不会自动公开。PDF/TXT≤10
                MiB，PPT/PPTX≤50 MiB；AI解析仅支持文字资料。
              </p>
              <input
                aria-label="上传出题专用资料"
                type="file"
                accept={materialAccept}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
              <button disabled={!file} onClick={() => void upload()}>
                保存出题专用资料
              </button>
              {uploadProgress !== undefined && (
                <p role="status">
                  上传 {uploadProgress}%
                  {uploadProgress === 100 ? "，正在校验保存…" : ""}
                </p>
              )}
            </section>
            <section className="authoring-card authoring-form">
              <h2>选定范围，查看实际摘录</h2>
              {selected.map((source) => (
                <div className="ai-source-range" key={source.document_id}>
                  <strong>
                    {chosen[source.document_id]?.title ||
                      `资料#${source.document_id}`}
                  </strong>
                  {["pdf", "pptx"].includes(
                    chosen[source.document_id]?.file_type || "",
                  ) && (
                    <>
                      <label>
                        起始页
                        <input
                          aria-label={`资料${source.document_id}起始页`}
                          type="number"
                          min="1"
                          value={source.start_page}
                          onChange={(e) =>
                            updateSources(
                              selected.map((s) =>
                                s.document_id === source.document_id
                                  ? { ...s, start_page: Number(e.target.value) }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        结束页
                        <input
                          aria-label={`资料${source.document_id}结束页`}
                          type="number"
                          min={source.start_page}
                          max={source.start_page + 19}
                          value={source.end_page}
                          onChange={(e) =>
                            updateSources(
                              selected.map((s) =>
                                s.document_id === source.document_id
                                  ? { ...s, end_page: Number(e.target.value) }
                                  : s,
                              ),
                            )
                          }
                        />
                      </label>
                    </>
                  )}
                  <button
                    className="text-button"
                    onClick={() =>
                      updateSources(
                        selected.filter(
                          (s) => s.document_id !== source.document_id,
                        ),
                      )
                    }
                  >
                    移除此资料
                  </button>
                </div>
              ))}
              <button
                disabled={!selected.length}
                onClick={() => void readSources()}
              >
                预览出题摘录
              </button>
            </section>
            {preview && (
              <section className="authoring-card">
                <h2>将发送给DeepSeek的文字（{preview.characters}字）</h2>
                {preview.warnings.map((w, i) => (
                  <p className="notice" key={i}>
                    {w}
                  </p>
                ))}
                {preview.chunks.map((c) => (
                  <details key={c.ref}>
                    <summary>
                      {c.title} · 第{c.page}页 · {c.text.length}字
                    </summary>
                    <pre className="ai-source-text">{c.text}</pre>
                  </details>
                ))}
                <p>
                  仅这些摘录会参与本次生成；点击下一步后仍需点击“调用DeepSeek生成候选题”。
                </p>
                <button onClick={() => go("generate")}>
                  核对完摘录，设置出题要求 →
                </button>
              </section>
            )}
          </>
        )}
        {step === "generate" && (
          <section className="authoring-card authoring-form">
            <h2>这次需要什么题？</h2>
            <label>
              所属章节
              <select
                aria-label="出题所属章节"
                value={chapter}
                onChange={(e) => {
                  setChapter(Number(e.target.value));
                  setKnowledge([]);
                  requestKey.current = "";
                }}
              >
                {chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              关联知识点（可多选）
              <select
                aria-label="出题关联知识点"
                multiple
                value={knowledge.map(String)}
                onChange={(e) => {
                  setKnowledge(
                    Array.from(e.target.selectedOptions, (o) =>
                      Number(o.value),
                    ),
                  );
                  requestKey.current = "";
                }}
              >
                {points
                  .filter((p) => p.chapter_id === chapter && !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} {p.title}
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <strong>需要的题型</strong>
              {Object.entries(typeNames).map(([key, label]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={kinds.includes(key as StudyQuestion["kind"])}
                    onChange={(e) => {
                      setKinds(
                        e.target.checked
                          ? [...kinds, key as StudyQuestion["kind"]]
                          : kinds.filter((k) => k !== key),
                      );
                      requestKey.current = "";
                    }}
                  />
                  {label}
                </label>
              ))}
            </div>
            <label>
              题目数量（1–10）
              <input
                aria-label="生成题目数量"
                type="number"
                min="1"
                max="10"
                value={count}
                onChange={(e) => {
                  setCount(Number(e.target.value));
                  requestKey.current = "";
                }}
              />
            </label>
            <label>
              难度
              <select
                aria-label="出题难度"
                value={difficulty}
                onChange={(e) => {
                  setDifficulty(e.target.value);
                  requestKey.current = "";
                }}
              >
                <option value="basic">基础理解</option>
                <option value="intermediate">应用分析</option>
                <option value="advanced">综合思考</option>
              </select>
            </label>
            <label>
              补充要求
              <textarea
                aria-label="出题补充要求"
                maxLength={1000}
                rows={5}
                value={focus}
                onChange={(e) => {
                  setFocus(e.target.value);
                  requestKey.current = "";
                }}
                placeholder="例如：侧重进程状态转换，避免超出本次资料。"
              />
            </label>
            <p>
              本次发送已预览的{preview?.characters || 0}字摘录至DeepSeek，模型{" "}
              {status?.model || "deepseek-chat"}
              ，可能产生服务商费用。不会自动发布；引用匹配也不保证答案正确。
            </p>
            <button
              disabled={
                !preview ||
                !status?.configured ||
                !chapter ||
                !kinds.length ||
                count < 1 ||
                count > 10
              }
              onClick={() => void generate()}
            >
              调用DeepSeek生成候选题
            </button>
          </section>
        )}
        {step === "review" && (
          <section className="authoring-card">
            <h2>逐题审核后再入库</h2>
            <button className="secondary" onClick={() => void reloadJob()}>
              刷新本次任务
            </button>
            {job ? (
              <>
                <p>
                  任务 #{job.id} · {job.model} ·{" "}
                  {job.status === "succeeded"
                    ? "候选已生成"
                    : job.status === "running"
                      ? "生成中，请稍后刷新"
                      : job.status}
                </p>
                <Notice error={job.error} />
                {job.warnings.map((w, i) => (
                  <p className="notice" key={i}>
                    {w}
                  </p>
                ))}
                {job.drafts.map((d) => (
                  <div className="ai-draft-row" key={d.id}>
                    <span className="badge">{typeNames[d.question.kind]}</span>
                    <h3>{d.question.prompt}</h3>
                    <p>原文依据：{d.source_quote}</p>
                    <small>
                      {
                        job.sources.chunks.find((c) => c.ref === d.source_ref)
                          ?.title
                      }{" "}
                      · {d.source_ref}
                    </small>
                    <div className="row-actions">
                      {d.status === "pending" ? (
                        <>
                          <Link
                            className="button"
                            to={`/teacher/questions?aiDraft=${d.id}`}
                          >
                            自动填写，进入审核 →
                          </Link>
                          <button
                            className="danger"
                            onClick={async () => {
                              if (!confirm("弃用这个候选题？不会加入题库。"))
                                return;
                              try {
                                await aiQuestionApi.reject(d);
                                await reloadJob();
                              } catch (e) {
                                setError((e as Error).message);
                              }
                            }}
                          >
                            弃用
                          </button>
                        </>
                      ) : (
                        <span>
                          {d.status === "imported"
                            ? `已存入题库草稿 #${d.question_id}`
                            : "已弃用"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {!job.drafts.length && (
                  <p>暂无候选题；任务失败或仍在生成时不会自动产生题库内容。</p>
                )}
              </>
            ) : (
              <p>请选择一条出题任务。</p>
            )}
          </section>
        )}
      </fieldset>
      <details className="authoring-card">
        <summary>最近30次出题任务（刷新后仍保留）</summary>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refreshJobs().catch((e) => setError(e.message))}
        >
          刷新任务记录
        </button>
        {jobs.map((j) => (
          <p key={j.id}>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => go("review", j.id)}
            >
              任务 #{j.id} · {j.status} · {j.created_at} UTC →
            </button>
          </p>
        ))}
        {!jobs.length && <p>尚无出题任务</p>}
      </details>
    </AuthoringPage>
  );
}
