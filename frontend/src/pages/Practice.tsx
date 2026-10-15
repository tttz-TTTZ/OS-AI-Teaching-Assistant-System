import { useSearchParams } from "react-router-dom";
import { useEffect, useState, FormEvent } from "react";
import { courseApi, Question, Grade } from "../api";
import { Page, Notice, useChapters, ChapterSelect } from "../components";
export default function Practice() {
  const { chapters, error } = useChapters();
  const [params] = useSearchParams();
  const [chapter, setChapter] = useState(Number(params.get("chapter")) || 0);
  useEffect(() => {
    if (!chapter && chapters[0]) setChapter(chapters[0].id);
  }, [chapters, chapter]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [grade, setGrade] = useState<Grade>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setAnswers({});
    setGrade(undefined);
    setFailure("");
    setQuestions([]);
    if (!chapter) return;
    setLoading(true);
    courseApi
      .questions(chapter)
      .then((q) => {
        if (active) setQuestions(q);
      })
      .catch((e) => {
        if (active) setFailure(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [chapter]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      setGrade(await courseApi.submit(answers));
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="章节练习">
      <section className="panel">
        <ChapterSelect
          value={chapter}
          onChange={setChapter}
          chapters={chapters}
        />
        <p>人工编写的示例单选题，用于验证学习流程，不代表完整题库。</p>
      </section>
      <Notice error={error || failure} />
      {loading ? (
        <p>加载中…</p>
      ) : (
        <form onSubmit={submit}>
          {questions.map((q, i) => {
            const result = grade?.results.find((r) => r.id === q.id);
            return (
              <fieldset className="panel spaced" key={q.id}>
                <legend>
                  {i + 1}. {q.prompt}
                </legend>
                {q.options.map((o, index) => (
                  <label className="option" key={index}>
                    <input
                      type="radio"
                      name={`q${q.id}`}
                      required
                      checked={answers[q.id] === index}
                      disabled={!!grade || busy}
                      onChange={() => setAnswers({ ...answers, [q.id]: index })}
                    />
                    {String.fromCharCode(65 + index)}. {o}
                  </label>
                ))}
                {result && (
                  <div className={result.correct ? "feedback" : "notice"}>
                    <strong>
                      {result.correct ? "回答正确" : "回答错误"} · 正确答案{" "}
                      {String.fromCharCode(65 + result.answer)}
                    </strong>
                    <p>{result.explanation}</p>
                  </div>
                )}
              </fieldset>
            );
          })}
          {questions.length ? (
            <div className="toolbar spaced">
              <button disabled={busy || !!grade}>
                {busy ? "提交中…" : "提交练习"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setAnswers({});
                  setGrade(undefined);
                  setFailure("");
                }}
              >
                重新练习
              </button>
              {grade && (
                <b>
                  本次得分：{grade.score} / {grade.total}
                </b>
              )}
            </div>
          ) : (
            <p>该章节暂无题目</p>
          )}
        </form>
      )}
    </Page>
  );
}
