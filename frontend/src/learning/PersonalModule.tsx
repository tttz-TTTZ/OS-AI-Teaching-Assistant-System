import { useEffect, useState } from "react";
import {
  LearningModule,
  LearningAnalysis,
  Evidence,
} from "../personal";
import Markdown from "../Markdown";
import MindMap from "./MindMap";
import EvidenceDetails, { AnalysisSummary } from "./EvidenceDetails";
export default function PersonalModule({
  module,
  job,
  index,
  analysis,
  evidence,
}: {
  module: LearningModule;
  job: number;
  index: number;
  analysis?: LearningAnalysis;
  evidence?: Evidence;
}) {
  const [cardIndex, setCardIndex] = useState(0),
    [flipped, setFlipped] = useState(false);
  useEffect(() => {
    setCardIndex(0);
    setFlipped(false);
  }, [module, job]);
  return (
    <article className="personal-module">
      <h2>{module.title}</h2>
      {module.retired && <p className="notice">此历史内容所属功能已停用，仅保留已保存的文字。</p>}
      <Markdown content={module.text} />
      {analysis && <AnalysisSummary analysis={analysis} />}
      {module.mode === "flashcards" && !!module.cards?.length && (
        <section className="flashcard-deck" aria-label="知识闪卡">
          <p>
            第 {cardIndex + 1} / {module.cards.length} 张 ·
            点击翻面，不计入正式成绩
          </p>
          <button
            className={`flashcard-face ${flipped ? "is-back" : ""}`}
            aria-label={flipped ? "闪卡答案" : "闪卡问题"}
            onClick={() => setFlipped(!flipped)}
          >
            <small>{flipped ? "答案 / 解释" : "回忆问题"}</small>
            <span>
              {flipped
                ? module.cards[cardIndex].back
                : module.cards[cardIndex].front}
            </span>
            <small>{flipped ? "点击返回问题" : "点击查看答案"}</small>
          </button>
          <div className="row-actions">
            <button
              className="secondary"
              disabled={!cardIndex}
              onClick={() => {
                setCardIndex((i) => i - 1);
                setFlipped(false);
              }}
            >
              上一张
            </button>
            <button className="secondary" onClick={() => setFlipped(!flipped)}>
              {flipped ? "再看问题" : "显示答案"}
            </button>
            <button
              className="secondary"
              disabled={cardIndex === module.cards.length - 1}
              onClick={() => {
                setCardIndex((i) => i + 1);
                setFlipped(false);
              }}
            >
              下一张
            </button>
          </div>
          {analysis && evidence && (
            <EvidenceDetails
              analysis={analysis}
              evidence={evidence}
              ids={module.cards[cardIndex].fact_ids}
            />
          )}
        </section>
      )}
      {module.mode === "map" && (
        <>
          <MindMap module={module} job={job} index={index} />
          {analysis && evidence && (
            <EvidenceDetails analysis={analysis} evidence={evidence} />
          )}
        </>
      )}
      {module.mode === "code" && (
        <section>
          <p>
            语言：{module.language} ·
            仅讲解，不执行任意代码；教学伪代码以正文标注为准。
          </p>
          <pre className="personal-code">
            <code>{module.code}</code>
          </pre>
        </section>
      )}

    </article>
  );
}
