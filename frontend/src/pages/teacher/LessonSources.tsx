import { useEffect, useState } from "react";
import { Material, courseApi, documentApi } from "../../api";
import { aiQuestionApi, SourcePick, SourcePreview } from "../../aiQuestions";
import { materialAccept, materialFileError } from "../../materialFiles";
import { Notice } from "../../components";

export default function LessonSources({
  onReady,
}: {
  onReady: (sources: SourcePick[], preview: SourcePreview) => void;
}) {
  const [mode, setMode] = useState("public");
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<Material[]>([]);
  const [chosen, setChosen] = useState<Material[]>([]);
  const [ranges, setRanges] = useState<Record<number, [number, number]>>({});
  const [preview, setPreview] = useState<SourcePreview>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File>();
  const [paste, setPaste] = useState("");
  const [progress, setProgress] = useState<number>();
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        documentApi
          .list(mode === "public", { category: mode, q })
          .then((set) => {
            if (active) setDocs(set);
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [mode, q, refresh]);
  const selections = () =>
    chosen.map((d) => ({
      document_id: d.id,
      start_page: ranges[d.id]?.[0] || 1,
      end_page: ranges[d.id]?.[1] || 1,
    }));
  function add(d: Material) {
    setChosen((old) =>
      old.some((x) => x.id === d.id) ? old : [...old, d].slice(0, 5),
    );
    setPreview(undefined);
  }
  async function upload(value?: File) {
    if (!value) return;
    const problem = materialFileError(value);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const d = await courseApi.upload(value, "", setProgress);
      add(d);
      setMode("personal");
      setQ("");
      setRefresh((x) => x + 1);
      setFile(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(undefined);
    }
  }
  async function extract() {
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      setPreview(await aiQuestionApi.preview(selections()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Notice error={error} />
      <section className="authoring-card authoring-form">
        <h2>选择现有课件，或上传备课专用资料</h2>
        <p>
          支持PPT、PPTX、文字PDF、TXT。旧PPT会尝试直接读取文字，无需先买转换会员。图片文字需要OCR；复杂旧PPT可能无法解析。
        </p>
        <fieldset disabled={busy}>
          <div className="row-actions">
            <button
              type="button"
              className={mode === "public" ? "" : "secondary"}
              onClick={() => setMode("public")}
            >
              公共课程资料
            </button>
            <button
              type="button"
              className={mode === "personal" ? "" : "secondary"}
              onClick={() => setMode("personal")}
            >
              我的备课专用资料
            </button>
          </div>
          <label>
            查找课件
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="输入标题；最多显示50份"
            />
          </label>
          {loading ? (
            <p>正在读取资料…</p>
          ) : docs.length ? (
            <div className="lesson-source-list">
              {docs.map((d) => (
                <label key={d.id} className="lesson-source-option">
                  <input
                    type="checkbox"
                    checked={chosen.some((x) => x.id === d.id)}
                    disabled={
                      chosen.length >= 5 && !chosen.some((x) => x.id === d.id)
                    }
                    onChange={(e) => {
                      if (e.target.checked) add(d);
                      else {
                        setChosen(chosen.filter((x) => x.id !== d.id));
                        setPreview(undefined);
                      }
                    }}
                  />
                  <span>
                    {d.title} · {d.file_type || "文字"}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p>没有匹配资料，可以上传或粘贴授课文字。</p>
          )}
          <details>
            <summary>上传新文件 / 粘贴课件文字</summary>
            <p>
              新资料仅本人可读，不自动发布到公共资料。PPT/PPTX ≤50MiB，PDF/TXT
              ≤10MiB。
            </p>
            <label>
              备课文件
              <input
                type="file"
                accept={materialAccept}
                onChange={(e) => setFile(e.target.files?.[0])}
              />
            </label>
            <button type="button" disabled={!file} onClick={() => upload(file)}>
              上传并选择
            </button>
            {progress !== undefined && <p>上传进度 {progress}%</p>}
            <label>
              或直接粘贴文字
              <textarea
                rows={7}
                maxLength={100000}
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder="可以从课件中复制文字，保存成仅本人可读的TXT资料。"
              />
            </label>
            <button
              type="button"
              disabled={paste.trim().length < 30}
              onClick={() =>
                upload(
                  new File([paste], "备课文字.txt", { type: "text/plain" }),
                )
              }
            >
              保存文字并选择
            </button>
          </details>
        </fieldset>
      </section>
      <section className="authoring-card authoring-form">
        <h2>确定本次授课范围</h2>
        <p>
          每份选1–20页，最多5份、合计24000字。400页课件请按一个授课主题分批准备；页码是课件实际页序。
        </p>
        <fieldset disabled={busy}>
          {chosen.map((d) => (
            <div className="authoring-card" key={d.id}>
              <strong>{d.title}</strong>
              {["ppt", "pptx", "pdf"].includes(d.file_type || "") && (
                <div className="row-actions">
                  {[0, 1].map((part) => (
                    <label key={part}>
                      {part ? "结束页" : "起始页"}
                      <input
                        type="number"
                        min={1}
                        max={10000}
                        value={ranges[d.id]?.[part] || 1}
                        onChange={(e) => {
                          const next = [...(ranges[d.id] || [1, 1])] as [
                            number,
                            number,
                          ];
                          next[part] = Number(e.target.value);
                          setRanges({ ...ranges, [d.id]: next });
                          setPreview(undefined);
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setChosen(chosen.filter((x) => x.id !== d.id));
                  setPreview(undefined);
                }}
              >
                移除该资料
              </button>
            </div>
          ))}
          {!chosen.length && <p>请先选择至少一份课件。</p>}
          <button type="button" disabled={!chosen.length} onClick={extract}>
            {busy ? "正在处理…" : "提取并预览实际文字"}
          </button>
        </fieldset>
      </section>
      {preview && (
        <section className="authoring-card authoring-form">
          <h2>核对将发送的文字 · {preview.characters}字</h2>
          {preview.warnings.map((w, i) => (
            <p role="status" key={i}>
              {w}
            </p>
          ))}
          {preview.chunks.map((c) => (
            <details key={c.ref}>
              <summary>
                {c.title} · 第{c.page}/{c.total_pages}页
              </summary>
              <pre className="source-excerpt">{c.text}</pre>
            </details>
          ))}
          <p>
            缺少图片、图表或关键文字时，请补充资料后再生成。下一步才会调用DeepSeek，本次提取不调用模型。
          </p>
          <button type="button" onClick={() => onReady(selections(), preview)}>
            摘录已核对，设置教案要求 →
          </button>
        </section>
      )}
    </>
  );
}
