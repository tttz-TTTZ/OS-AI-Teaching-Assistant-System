import { useEffect, useState } from "react";
import { fileUrl, Material, request } from "../api";
import { Notice } from "../components";
interface SlidePage {
  total: number;
  offset: number;
  slides: { number: number; title: string; text: string; truncated: boolean }[];
}
export default function PresentationPreview({
  material,
}: {
  material: Material;
}) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SlidePage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setOffset(0);
  }, [material.id, material.sha256]);
  useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    if (material.file_type !== "pptx") return;
    setLoading(true);
    request<SlidePage>(
      `/materials/${material.id}/slides?offset=${offset}&limit=10`,
    )
      .then((value) => {
        if (active) setData(value);
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
  }, [material.id, material.sha256, material.file_type, offset]);
  if (!["ppt", "pptx"].includes(material.file_type || "")) return null;
  return (
    <section className="presentation-preview">
      <h3>课件阅读</h3>
      <p>
        原始课件完整保存。
        <a className="textlink" href={fileUrl(material.id, true)}>
          下载 {material.file_type?.toUpperCase()}，用 PowerPoint/WPS 打开 →
        </a>
      </p>
      {material.file_type === "ppt" ? (
        <p>
          旧版 PPT 暂不提供网页预览。可以在 WPS/PowerPoint 中另存为 PPTX
          后替换文件，或另上传 PDF 供阅读。
        </p>
      ) : (
        <>
          <p>
            下方仅展示每页可提取的文字；图片、公式、图表、音视频、讲者备注、动画及原排版请查看原件。不将文字页冒充原版幻灯片。
          </p>
          <Notice error={error} />
          {loading && <p role="status">正在读取课件文字…</p>}
          {data && (
            <>
              <div className="toolbar">
                <button
                  className="secondary"
                  disabled={offset === 0 || loading}
                  onClick={() => setOffset((n) => Math.max(0, n - 10))}
                >
                  前10页
                </button>
                <span>
                  共 {data.total} 页 · 当前 {offset + 1}–
                  {Math.min(offset + 10, data.total)} 页
                </span>
                <button
                  className="secondary"
                  disabled={offset + 10 >= data.total || loading}
                  onClick={() => setOffset((n) => n + 10)}
                >
                  后10页
                </button>
                <label>
                  跳至幻灯片
                  <select
                    aria-label="跳至幻灯片"
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value))}
                  >
                    {Array.from(
                      { length: Math.ceil(data.total / 10) },
                      (_, i) => (
                        <option key={i} value={i * 10}>
                          {i * 10 + 1}–{Math.min(i * 10 + 10, data.total)}页
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
              {data.slides.map((slide) => (
                <article key={slide.number} className="slide-text">
                  <h4>
                    第{slide.number}页 · {slide.title}
                  </h4>
                  <p>
                    {slide.text ||
                      "本页未提取到文字，可能是图片或图表，请下载原件查看。"}
                  </p>
                  {slide.truncated && (
                    <small>
                      文字过长，仅显示前20000字，完整内容请查看原件。
                    </small>
                  )}
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
