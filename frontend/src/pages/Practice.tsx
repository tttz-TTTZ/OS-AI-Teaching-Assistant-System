import { FormEvent, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Page, Notice, useChapters, ChapterSelect } from "../components";
import { digitalApi } from "../digital";
import {
  Answer,
  Attempt,
  StudyQuestion,
  StudyResult,
  studyApi,
  typeNames,
} from "../study";
import { useAuth } from "../auth";
export default function Practice() {
  const { chapters, error } = useChapters();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const point = Number(params.get("knowledge")) || undefined;
  const [chapter, setChapter] = useState(Number(params.get("chapter")) || 0);
  const [revision, setRevision] = useState(0);
  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [grade, setGrade] = useState<StudyResult>();
  const [failure, setFailure] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Attempt[]>([]);
  const key = useRef(crypto.randomUUID());
  const scope = `os:practice-draft:${user?.id}:${point ? "point-" + point : "chapter-" + chapter}`;
  useEffect(() => {
    if (!chapter && chapters[0]) setChapter(chapters[0].id);
  }, [chapters, chapter]);
  useEffect(() => {
    if (!chapter && !point) return;
    let active = true;
    setLoading(true);
    setGrade(undefined);
    setFailure("");
    key.current = crypto.randomUUID();
    Promise.all([
      studyApi.questions(chapter, point),
      point ? digitalApi.detail(point) : Promise.resolve(null),
    ])
      .then(([qs, content]) => {
        if (!active) return;
        setQuestions(qs);
        setRevision(content?.revision_id || 0);
        try {
          const draft = JSON.parse(sessionStorage.getItem(scope) || "null");
          setAnswers(
            draft?.versions === JSON.stringify(qs.map((q) => [q.id, q.version]))
              ? draft.answers
              : {},
          );
        } catch {
          setAnswers({});
        }
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
  }, [chapter, point, user?.id]);
  function choose(id: number, answer: Answer) {
    const next = { ...answers, [id]: answer };
    setAnswers(next);
    sessionStorage.setItem(
      scope,
      JSON.stringify({
        versions: JSON.stringify(questions.map((q) => [q.id, q.version])),
        answers: next,
      }),
    );
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure("");
    try {
      if (
        questions.some(
          (q) =>
            answers[q.id!] === undefined ||
            (Array.isArray(answers[q.id!]) &&
              !(answers[q.id!] as number[]).length),
        )
      )
        throw Error("请完成所有题目再提交");
      const result = await studyApi.submit(
        answers,
        Object.fromEntries(questions.map((q) => [q.id, q.version])),
        key.current,
        point,
        revision,
      );
      setGrade(result);
      sessionStorage.removeItem(scope);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function answerText(result: StudyResult["results"][number]) {
    if (result.kind === "short") return String(result.answer);
    if (result.kind === "matching")
      return (result.answer as number[])
        .map((a, i) => `${result.items[i]} → ${result.options[a]}`)
        .join("；");
    return (Array.isArray(result.answer) ? result.answer : [result.answer])
      .map((a) => String.fromCharCode(65 + Number(a)))
      .join("、");
  }
  return (
    <Page title="章节练习">
      <nav className="authoring-toolbar" aria-label="练习来源"><span className="button">教师正式练习</span><Link className="button secondary" to="/student/ai-practice">我的 AI 练习（按薄弱点生成）</Link></nav>
      <section className="panel">
        {point ? (
          <>
            <p>当前为知识点专项练习，不混入其他知识点的题目。</p>
            <Link
              to={`/student/knowledge?chapter=${chapter}&point=${point}&block=${params.get("block") || ""}`}
            >
              返回原知识点 →
            </Link>
          </>
        ) : (
          <ChapterSelect
            value={chapter}
            onChange={setChapter}
            chapters={chapters}
          />
        )}
        <p>
          客观题由后端判分；简答仅提供参考要点，不计入客观得分。未提交答案暂存本标签，提交后的历史保存在数据库。
        </p>
      </section>
      <Notice error={error || failure} />
      {loading ? (
        <p>加载中…</p>
      ) : (
        <form onSubmit={submit}>
          {questions.map((q, i) => {
            const id = q.id!;
            const result = grade?.results.find((r) => r.id === id);
            return (
              <fieldset
                key={id}
                className="panel spaced"
                disabled={busy || !!grade}
              >
                <legend>
                  {i + 1}. [{typeNames[q.kind]}] {q.prompt}
                </legend>
                {["single", "boolean"].includes(q.kind) &&
                  q.options.map((option, j) => (
                    <label key={j} className="option">
                      <input
                        type="radio"
                        name={"q" + id}
                        required
                        checked={answers[id] === j}
                        onChange={() => choose(id, j)}
                      />
                      {String.fromCharCode(65 + j)}. {option}
                    </label>
                  ))}
                {q.kind === "multiple" &&
                  q.options.map((option, j) => (
                    <label key={j} className="option">
                      <input
                        type="checkbox"
                        checked={((answers[id] || []) as number[]).includes(j)}
                        onChange={(e) =>
                          choose(
                            id,
                            e.target.checked
                              ? [...((answers[id] || []) as number[]), j]
                              : ((answers[id] || []) as number[]).filter(
                                  (v) => v !== j,
                                ),
                          )
                        }
                      />
                      {String.fromCharCode(65 + j)}. {option}
                    </label>
                  ))}
                {q.kind === "short" && (
                  <label>
                    我的回答
                    <textarea
                      aria-label="我的回答"
                      required
                      maxLength={5000}
                      value={String(answers[id] || "")}
                      onChange={(e) => choose(id, e.target.value)}
                    />
                  </label>
                )}
                {q.kind === "matching" &&
                  q.items.map((item, j) => (
                    <label key={j} className="option">
                      {item}
                      <select
                        required
                        value={(answers[id] as number[] | undefined)?.[j] ?? ""}
                        onChange={(e) => {
                          const next = [
                            ...((answers[id] ||
                              Array(q.items.length).fill(-1)) as number[]),
                          ];
                          next[j] = Number(e.target.value);
                          choose(id, next);
                        }}
                      >
                        <option value="">请选择分类</option>
                        {q.options.map((o, k) => (
                          <option key={k} value={k}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                {result && (
                  <div
                    className={result.correct === false ? "notice" : "feedback"}
                  >
                    <strong>
                      {result.correct === null
                        ? "简答参考 · 请对照自评"
                        : result.correct
                          ? "回答正确"
                          : "回答错误"}{" "}
                      · {result.correct === null ? "参考答案" : "正确答案"}{" "}
                      {answerText(result)}
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
                  setGrade(undefined);
                  setAnswers({});
                  key.current = crypto.randomUUID();
                  sessionStorage.removeItem(scope);
                }}
              >
                重新练习
              </button>
              {grade && (
                <>
                  <b>
                    本次得分：{grade.score} / {grade.total}
                  </b>
                  {grade.ungraded > 0 && (
                    <span>{grade.ungraded} 道简答未评分，不计入客观分数</span>
                  )}
                </>
              )}
            </div>
          ) : (
            <p>暂无关联题目，请教师在题库中关联本知识点。</p>
          )}
        </form>
      )}
      <section className="panel spaced">
        <h2>我的作答历史与错题</h2>
        <button
          className="secondary"
          onClick={async () => {
            try {
              setHistory(await studyApi.attempts());
            } catch (e) {
              setFailure((e as Error).message);
            }
          }}
        >
          加载作答历史
        </button>
        {history.map((h) => (
          <details key={h.id}>
            <summary>
              {h.created_at} · {h.score}/{h.total} · {h.ungraded} 道未评分
            </summary>
            {h.results
              .filter((r) => r.correct !== true)
              .map((r) => (
                <div className="resource" key={r.id}>
                  <strong>
                    {r.correct === null ? "自评复习" : "错题"}：{r.prompt}
                  </strong>
                  <p>
                    我的作答：{answerText({ ...r, answer: r.selected })}；参考：
                    {answerText(r)}
                  </p>
                  <p>{r.explanation}</p>
                </div>
              ))}
            {h.point_id && (
              <Link to={`/student/knowledge?point=${h.point_id}`}>
                返回相关知识点
              </Link>
            )}
          </details>
        ))}
      </section>
    </Page>
  );
}
