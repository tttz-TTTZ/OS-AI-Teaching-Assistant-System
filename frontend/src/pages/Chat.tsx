import { useEffect, useRef, useState, FormEvent } from "react";
import { api, courseApi, Health } from "../api";
import { Page, Notice } from "../components";
type Message = { role: "user" | "assistant"; text: string };
export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState<Health>();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    courseApi
      .health()
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  async function send(e: FormEvent) {
    e.preventDefault();
    const text = question.trim();
    if (!text || busy) return;
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }]);
    setQuestion("");
    try {
      const r = await api.chat(text);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `${r.mode === "mock" ? "[演示模式，未调用真实 AI] " : ""}${r.answer}`,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
      setQuestion(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="智能问答">
      <section className="panel">
        <div className="toolbar">
          <h2>课程 AI 助教</h2>
          <button
            disabled={busy}
            className="secondary"
            onClick={() => {
              setMessages([]);
              setError("");
            }}
          >
            清空当前对话
          </button>
        </div>
        <p>
          当前接口按单个问题调用模型，消息列表仅保存在当前页面。清空不删除后端已保存的记录；不提供
          RAG 或可靠资料溯源。
        </p>
        {health && !health.ai_configured && (
          <p className="notice">
            尚未配置 AI 服务。请在后端 .env 中设置密钥及 LLM_MODE=openai。
            {health.llm_mode === "mock" ? "当前为显式演示模式。" : ""}
          </p>
        )}
        <div className="messages">
          {!messages.length && (
            <p className="empty">试试提问：进程与线程有什么区别？</p>
          )}
          {messages.map((m, i) => (
            <article className={`message ${m.role}`} key={i}>
              <b>{m.role === "user" ? "我" : "AI 助教"}</b>
              <p>{m.text}</p>
            </article>
          ))}
          {busy && <p role="status">正在等待模型响应…</p>}
          <div ref={end} />
        </div>
        <Notice error={error} />
        <form onSubmit={send}>
          <label htmlFor="question">输入问题</label>
          <textarea
            id="question"
            required
            maxLength={8000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="输入操作系统相关问题…"
          />
          <button disabled={busy || !question.trim()}>发送问题</button>
        </form>
      </section>
    </Page>
  );
}
