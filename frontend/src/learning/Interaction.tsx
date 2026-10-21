import { useEffect, useState } from "react";
import {
  ContentBlock,
  digitalApi,
  SimConfig,
  templates,
  Trace,
} from "../digital";
import { Notice } from "../components";

export function ConfigFields({
  value,
  onChange,
}: {
  value: SimConfig;
  onChange: (c: SimConfig) => void;
}) {
  const t = value.template;
  const fields: [keyof SimConfig, string, number, number, number][] = [];
  if (t === "race") fields.push(["initial", "初始计数值", 0, 0, 1000]);
  if (t === "memory")
    fields.push(
      ["capacity", "内存容量 MB", 1024, 1, 65536],
      ["allocation_a", "A 分配 MB", 256, 0, 65536],
      ["allocation_b", "B 分配 MB", 256, 0, 65536],
      ["allocation_c", "C 分配 MB", 256, 0, 65536],
    );
  if (["timeshare", "concurrency", "printer"].includes(t))
    fields.push(["tasks", "任务数", 3, 1, 10]);
  if (["timeshare", "concurrency"].includes(t))
    fields.push(
      ["quantum", "时间片", 2, 1, 20],
      ["duration", "每任务CPU工作量", 4, 1, 20],
      ["arrival_gap", "任务到达间隔", 0, 0, 10],
      ["switch_cost", "切换开销", 0, 0, 5],
    );
  if (t === "concurrency") fields.push(["cores", "CPU核心数", 1, 1, 2]);
  if (["async", "concurrency"].includes(t))
    fields.push(["io_delay", "I/O延迟", 3, 1, 20]);
  return (
    <div className="sim-config">
      {fields.map(([key, title, defaultValue, min, max]) => (
        <label key={key}>
          {title}
          <input
            type="number"
            min={min}
            max={max}
            step="1"
            value={Number(value[key] ?? defaultValue)}
            onChange={(e) =>
              onChange({ ...value, [key]: Number(e.target.value) })
            }
          />
        </label>
      ))}
      {t === "layers" && (
        <label>
          请求场景
          <select
            aria-label="请求场景"
            value={value.scenario || 0}
            onChange={(e) =>
              onChange({ ...value, scenario: Number(e.target.value) })
            }
          >
            <option value={0}>打开文件</option>
            <option value={1}>播放音乐</option>
          </select>
        </label>
      )}
      {t === "race" && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={!!value.locked}
              onChange={(e) => onChange({ ...value, locked: e.target.checked })}
            />
            互斥锁保护
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={value.interleaved ?? true}
              onChange={(e) =>
                onChange({ ...value, interleaved: e.target.checked })
              }
            />
            交错读取（无锁时）
          </label>
        </>
      )}
    </div>
  );
}

export default function Interaction({
  point,
  revision,
  block,
  preview = false,
  onComplete,
  active = true,
}: {
  point: number;
  revision: number;
  block: ContentBlock;
  preview?: boolean;
  onComplete?: () => void;
  active?: boolean;
}) {
  const [config, setConfig] = useState<SimConfig>(block.config!);
  const [trace, setTrace] = useState<Trace>();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (!active || !playing || !trace) return;
    const timer = setInterval(
      () =>
        setIndex((i) => {
          if (i >= trace.frames.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1000 / speed,
    );
    return () => clearInterval(timer);
  }, [active, playing, trace, speed]);
  function change(c: SimConfig) {
    setConfig(c);
    setTrace(undefined);
    setPlaying(false);
    setSaved(false);
    setError("参数已修改，请重新生成事件。");
  }
  async function run() {
    setBusy(true);
    setError("");
    setPlaying(false);
    try {
      setTrace(await digitalApi.run(point, revision, block, config, preview));
      setIndex(0);
      setSaved(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const frame = trace?.frames[index];
  return (
    <div className="interactive">
      <div className="toolbar">
        <span className="badge">{templates[config.template]}</span>
        <small>教学简化模型 · 参数改变后重新运行</small>
      </div>
      <details className="interaction-settings" open={!trace}>
        <summary>调整观察条件</summary>
        <ConfigFields value={config} onChange={change} />
      </details>
      <button type="button" disabled={busy} onClick={run}>
        {busy ? "计算中…" : "生成教学事件"}
      </button>
      <Notice error={error} />
      {frame && trace && (
        <>
          {[
            "layers",
            "perspectives",
            "goals",
            "resources",
            "roles",
            "history",
          ].includes(config.template) && (
            <div className="toolbar">
              {trace.frames.map((f, i) => (
                <button
                  type="button"
                  className={index === i ? "" : "secondary"}
                  key={i}
                  onClick={() => {
                    setPlaying(false);
                    setIndex(i);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div className="sim-frame" aria-live="polite">
            <h4>{frame.label}</h4>
            <div
              className={
                config.template === "memory" ? "memory-strip" : "sim-nodes"
              }
            >
              {frame.nodes.map((node, i) => (
                <div
                  className={
                    "sim-node " + (node.state === "当前" ? "active" : "")
                  }
                  key={i}
                  style={
                    config.template === "memory"
                      ? {
                          flexGrow: Math.max(node.value || 0, 0.01),
                          flexBasis: 0,
                        }
                      : undefined
                  }
                >
                  <strong>{node.name}</strong>
                  <span>{node.state}</span>
                  {node.value !== undefined && (
                    <b>
                      {node.value}
                      {config.template === "memory" ? " MB" : ""}
                    </b>
                  )}
                </div>
              ))}
            </div>
            <p>{frame.explanation}</p>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={!index}
              onClick={() => {
                setPlaying(false);
                setIndex((i) => Math.max(0, i - 1));
              }}
            >
              上一步
            </button>
            <button
              type="button"
              className="secondary"
              disabled={index === trace.frames.length - 1}
              onClick={() => {
                setPlaying(false);
                setIndex((i) => Math.min(trace.frames.length - 1, i + 1));
              }}
            >
              下一步
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (index === trace.frames.length - 1) setIndex(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? "暂停" : "自动播放"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setPlaying(false);
                setIndex(0);
              }}
            >
              重置播放
            </button>
            <label>
              速度
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
              >
                {[0.5, 1, 2, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label>
            事件进度 {index + 1}/{trace.frames.length}
            <input
              aria-label="事件进度"
              type="range"
              min="0"
              max={trace.frames.length - 1}
              value={index}
              onChange={(e) => {
                setPlaying(false);
                setIndex(Number(e.target.value));
              }}
            />
          </label>
          <details>
            <summary>事件日志（可点击回放）</summary>
            <ol className="event-log">
              {trace.frames.map((f, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setPlaying(false);
                      setIndex(i);
                    }}
                  >
                    {f.time} · {f.label}
                  </button>
                </li>
              ))}
            </ol>
          </details>
          {!preview && (
            <button
              type="button"
              className="secondary"
              disabled={index !== trace.frames.length - 1 || saved || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await digitalApi.complete(trace.id, index);
                  setSaved(true);
                  onComplete?.();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {saved ? "已记录观察完成" : "记录本次观察完成"}
            </button>
          )}
          <small>观察完成只记录学习操作，不等于已掌握。</small>
        </>
      )}
    </div>
  );
}
