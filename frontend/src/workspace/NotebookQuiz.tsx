import { useEffect, useRef, useState } from "react";
import { PersonalJob, PersonalGrade, personalApi } from "../personal";
import { Notice } from "../components";
import Markdown from "../Markdown";

export default function NotebookQuiz({ job, userId }: { job: PersonalJob; userId: number }) {
  const [answers, setAnswers] = useState<Record<number, unknown>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`personal-answers:${userId}:${job.id}`) || "{}");
    } catch {
      return {};
    }
  });
  const [grade, setGrade] = useState<PersonalGrade>();
  const [attempts, setAttempts] = useState<PersonalGrade[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitKey = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true;
    personalApi.attempts(job.id).then((data) => {
      if (active) setAttempts(data);
    }).catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [job.id]);
  function choose(index: number, answer: unknown) {
    const next = { ...answers, [index]: answer };
    setAnswers(next);
    if (job)
      sessionStorage.setItem(
        `personal-answers:${userId}:${job.id}`,
        JSON.stringify(next),
      );
  }
  function answerText(index: number, value: unknown) {
    const question = job?.body.questions?.[index];
    if (!question || question.kind === "short")
      return String(value ?? "未作答");
    const selected = Array.isArray(value) ? value : [value];
    return selected
      .map((v, i) =>
        question.kind === "matching"
          ? `${question.items[i]} → ${question.options[Number(v)] || "未选择"}`
          : question.options[Number(v)] || "未选择",
      )
      .join("；");
  }
  async function submit() {
    if (!job) return;
    setBusy(true);
    setError("");
    try {
      setGrade(await personalApi.submit(job.id, answers, submitKey.current));
      setAttempts(await personalApi.attempts(job.id));
      sessionStorage.removeItem(`personal-answers:${userId}:${job.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="authoring-card authoring-form personal-quiz">
      <h2>测验</h2>
      <Notice error={error} />
      {job.body.questions?.length !== job.body.requested_count && (
        <p>
          资料仅支持生成{job.body.questions?.length}
          题，少于请求数量，请先核对题目。
        </p>
      )}
      {job.body.questions?.map((question, i) => (
        <fieldset
          className="authoring-card"
          key={i}
          disabled={busy || !!grade}
        >
          <legend>
            {i + 1}. {question.prompt}
          </legend>
          {question.kind === "short" ? (
            <textarea
              rows={5}
              maxLength={5000}
              value={String(answers[i] || "")}
              onChange={(e) => choose(i, e.target.value)}
            />
          ) : question.kind === "matching" ? (
            question.items.map((item, j) => (
              <label key={j}>
                {item}
                <select
                  value={
                    (answers[i] as number[] | undefined)?.[j] ?? -1
                  }
                  onChange={(e) => {
                    const next = [
                      ...((answers[i] as number[]) ||
                        Array(question.items.length).fill(-1)),
                    ];
                    next[j] = Number(e.target.value);
                    choose(i, next);
                  }}
                >
                  <option value={-1}>请选择</option>
                  {question.options.map((o, k) => (
                    <option key={k} value={k}>
                      {o}
                    </option>
                  ))}
                </select>
              </label>
            ))
          ) : (
            question.options.map((o, j) => (
              <label className="quiz-option" key={j}>
                <input
                  type={
                    question.kind === "multiple"
                      ? "checkbox"
                      : "radio"
                  }
                  name={`personal-${i}`}
                  checked={
                    question.kind === "multiple"
                      ? ((answers[i] as number[]) || []).includes(j)
                      : answers[i] === j
                  }
                  onChange={(e) =>
                    choose(
                      i,
                      question.kind === "multiple"
                        ? e.target.checked
                          ? [...((answers[i] as number[]) || []), j]
                          : ((answers[i] as number[]) || []).filter(
                              (x) => x !== j,
                            )
                        : j,
                    )
                  }
                />
                <span className="quiz-option-content">
                  <span aria-hidden="true">
                    {String.fromCharCode(65 + j)}.{" "}
                  </span>
                  {o}
                </span>
              </label>
            ))
          )}
        </fieldset>
      ))}
      {!grade && (
        <button disabled={busy} onClick={submit}>
          提交我的自测
        </button>
      )}
      {grade && (
        <>
          <p role="status">
            个人自测：{grade.score} / {grade.total}；{grade.ungraded}
            题需自行对照参考答案
          </p>
          {grade.results.map((r) => (
            <section key={r.index}>
              <h3>
                {r.index + 1}.{" "}
                {r.correct === null
                  ? "请对照参考"
                  : r.correct
                    ? "回答正确"
                    : "需要巩固"}
              </h3>
              <p>你的回答：{answerText(r.index, r.selected)}</p>
              <p>参考答案：{answerText(r.index, r.answer)}</p>
              <Markdown content={r.explanation} />
            </section>
          ))}
          <button
            className="secondary"
            onClick={() => {
              setGrade(undefined);
              setAnswers({});
              submitKey.current = crypto.randomUUID();
            }}
          >
            重新自测
          </button>
        </>
      )}
      <details>
        <summary>本题组作答记录（{attempts.length}次）</summary>
        {attempts.map((a, i) => (
          <p key={i}>
            第{attempts.length - i}次：{a.score}/{a.total}，未自动评分
            {a.ungraded}题
            <button
              className="secondary"
              onClick={() => {
                setGrade(a);
                setAnswers(
                  Object.fromEntries(
                    a.results.map((r) => [r.index, r.selected]),
                  ),
                );
              }}
            >
              查看本次解析
            </button>
          </p>
        ))}
      </details>
    </section>
  );
}
