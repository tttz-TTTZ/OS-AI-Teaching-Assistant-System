import { Link } from "react-router-dom";
import { Evidence, PilotAnalysis } from "../personal";
export default function PilotEvidence({
  analysis,
  evidence,
  ids,
}: {
  analysis: PilotAnalysis;
  evidence: Evidence;
  ids?: string[];
}) {
  const facts = analysis.facts.filter((f) => !ids || ids.includes(f.id));
  return (
    <details className="pilot-evidence">
      <summary>查看{facts.length}条知识依据（AI辅助，待核对）</summary>
      {facts.map((f) => (
        <section key={f.id}>
          <strong>{f.title}</strong>
          <p>{f.statement}</p>
          {f.evidence.map((e, i) => {
            const c = evidence.chunks.find((c) => c.ref === e.ref);
            return (
              <blockquote key={i}>
                {e.quote}
                <br />
                {c && (
                  <Link to={`/student/materials?document=${c.document_id}`}>
                    {c.title} · 第{c.page}页
                  </Link>
                )}
              </blockquote>
            );
          })}
        </section>
      ))}
    </details>
  );
}
export function PilotSummary({ analysis }: { analysis: PilotAnalysis }) {
  const m = analysis.metrics;
  function download() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(analysis, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "小节提炼报告.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="pilot-summary" aria-label="小节提炼报告">
      <h3>本次知识提炼</h3>
      <p>
        正文块处理 {m.processed_chunks}/{m.selected_chunks}；{m.concepts}
        个概念，{m.facts}条去重结论。本成果引用
        {Math.round(m.artifact_fact_coverage * 100)}%的结论。
      </p>
      <p>
        复用{analysis.cached_batches}批，本次模型调用{analysis.calls_used}
        次；目录标记{analysis.plan.excluded.length}块，未识别文字
        {analysis.plan.unreadable_pages.length}页。
      </p>
      <p>
        处理比例和引用比例不能证明知识正确或已覆盖全部考点，仍需核对原课件。
      </p>
      <button className="secondary" onClick={download}>
        下载试点报告
      </button>
    </section>
  );
}
