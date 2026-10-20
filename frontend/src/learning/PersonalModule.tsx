import { useEffect, useState } from "react";
import { LearningModule, personalApi } from "../personal";
import Markdown from "../Markdown";
import { SimConfig, Trace } from "../digital";
import { ConfigFields } from "./Interaction";
export default function PersonalModule({
  module,
  job,
  index,
}: {
  module: LearningModule;
  job: number;
  index: number;
}) {
  const [step, setStep] = useState(0),
    [playing, setPlaying] = useState(false);
  const [trace, setTrace] = useState<Trace>(),
    [error, setError] = useState("");
  const [config, setConfig] = useState<SimConfig | null>(module.simulation);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setStep(0);
    setPlaying(false);
    setTrace(undefined);
    setConfig(module.simulation);
    setError("");
  }, [module, job]);
  async function run() {
    if (!config) return;
    setBusy(true);
    setError("");
    try {
      setTrace(await personalApi.simulate(job, index, config));
      setStep(0);
      setPlaying(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const frames =
    trace?.frames.map((f) => ({
      ...f,
      nodes: f.nodes.map(
        (n) =>
          `${n.name}：${n.state}${n.value === undefined ? "" : ` (${n.value})`}`,
      ),
    })) || module.frames;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        setStep((s) => {
          if (s >= frames.length - 1) {
            setPlaying(false);
            return s;
          }
          return s + 1;
        }),
      1200,
    );
    return () => clearInterval(timer);
  }, [playing, frames.length]);
  function tree(parent: string | null, depth = 0): React.ReactNode {
    if (depth > 60) return null;
    return (
      <ul>
        {module.nodes
          .filter((n) => n.parent === parent)
          .map((n) => (
            <li key={n.id}>
              <span>{n.label}</span>
              {module.nodes.some((c) => c.parent === n.id) &&
                tree(n.id, depth + 1)}
            </li>
          ))}
      </ul>
    );
  }
  return (
    <article className="personal-module">
      <h2>{module.title}</h2>
      <Markdown content={module.text} />
      {module.mode === "map" && (
        <div className="personal-mindmap" aria-label="个人思维导图">
          {tree(null)}
        </div>
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
      {module.mode === "animation" && (
        <section className="authoring-card">
          <h3>{module.simulation ? "可计算教学演示" : "AI概念分步演示"}</h3>
          <p>
            {trace?.disclaimer ||
              (module.simulation
                ? "调整参数并运行，过程由现有教学状态机计算。"
                : "AI生成的概念画面，可以回放观察，不作为算法正确性证明。")}
          </p>
          {config && (
            <>
              <ConfigFields value={config} onChange={setConfig} />
              <button disabled={busy} onClick={run}>
                {busy ? "正在计算…" : "运行演示"}
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
          {!!frames.length && (
            <>
              <div className="row-actions">
                <button onClick={() => setPlaying(!playing)}>
                  {playing ? "暂停" : "播放"}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setPlaying(false);
                    setStep(Math.max(0, step - 1));
                  }}
                >
                  上一步
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setPlaying(false);
                    setStep(Math.min(frames.length - 1, step + 1));
                  }}
                >
                  下一步
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setPlaying(false);
                    setStep(0);
                  }}
                >
                  重置
                </button>
                <span>
                  {step + 1}/{frames.length}
                </span>
              </div>
              <h4>{frames[step]?.label}</h4>
              <p>{frames[step]?.explanation}</p>
              <div className="personal-frame">
                {frames[step]?.nodes.map((n, i) => (
                  <span key={i}>{n}</span>
                ))}
              </div>
            </>
          )}
        </section>
      )}
    </article>
  );
}
