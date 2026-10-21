import { Content, assetUrl } from "../digital";
import Markdown from "../Markdown";
import Interaction from "./Interaction";
import KnowledgeDiagram from "./KnowledgeDiagram";
export default function ContentView({
  content,
  preview = false,
  onComplete,
  onPosition,
  focus,
  active = true,
}: {
  content: Content;
  focus?: string;
  active?: boolean;
  preview?: boolean;
  onComplete?: () => void;
  onPosition?: (id: string) => void;
}) {
  return (
    <article className="digital-content">
      {(!focus || focus === "overview") && (
        <>
          <div className="toolbar">
            <span className="badge">{content.code || "课程知识点"}</span>
            {content.emphasis && (
              <span className="badge">{content.emphasis}</span>
            )}
            {content.minutes && <small>建议 {content.minutes} 分钟</small>}
          </div>
          {!focus && <h2>{content.title}</h2>}
          {content.summary && <p className="lead">{content.summary}</p>}
          {content.objectives && (
            <section className="learning-objectives">
              <h3>学习目标</h3>
              <Markdown content={content.objectives} />
            </section>
          )}
        </>
      )}
      {content.blocks
        .filter((block) => !focus || block.id === focus)
        .map((block) => (
          <section
            id={"block-" + block.id}
            key={block.id}
            className={"content-block kind-" + block.kind}
            onFocus={() => onPosition?.(block.id)}
            onClick={() => onPosition?.(block.id)}
          >
            <h3>{block.title || "学习内容"}</h3>
            {block.text && <Markdown content={block.text} />}
            {block.kind === "diagram" && block.diagram && (
              <KnowledgeDiagram diagram={block.diagram} />
            )}
            {block.kind === "image" && block.asset_id && (
              <figure>
                <img
                  src={assetUrl(block.asset_id)}
                  alt={block.alt || block.title}
                  loading="lazy"
                />
                <figcaption>{block.alt}</figcaption>
              </figure>
            )}
            {block.kind === "interaction" && block.config && content.id && (
              <Interaction
                point={content.id}
                revision={content.revision_id || 0}
                block={block}
                preview={preview}
                active={active}
                onComplete={onComplete}
              />
            )}
            {block.kind === "chart" && (
              <div className="data-chart">
                {block.labels?.map((label, i) => (
                  <div key={i}>
                    <span>{label}</span>
                    <meter
                      min="0"
                      max={Math.max(...(block.values || [1]), 1)}
                      value={block.values?.[i] || 0}
                    />
                    <b>
                      {block.values?.[i]} {block.unit}
                    </b>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      {!focus &&
        (content.source_title ||
          content.printed_pages ||
          content.pdf_pages ||
          content.source_note) && (
          <section className="source-info">
            <h3>内容来源与页码</h3>
            <p>{content.source_title || "来源待核对"}</p>
            {content.printed_pages && (
              <p>教材印刷页：{content.printed_pages}</p>
            )}
            {content.pdf_pages && <p>PDF页序：{content.pdf_pages}</p>}
            {content.source_note && <Markdown content={content.source_note} />}
          </section>
        )}
    </article>
  );
}
