import { useEffect, useState } from "react";
import {
  Algorithm,
  ScheduleConfig,
  ScheduleResult,
  algorithmNames,
  algorithmRules,
  exampleProcesses,
} from "../experiments";

export function ProcessEditor({
  value,
  onChange,
  algorithm,
  disabled = false,
}: {
  value: ScheduleConfig;
  onChange: (value: ScheduleConfig) => void;
  algorithm: Algorithm;
  disabled?: boolean;
}) {
  function edit(i: number, key: "pid" | "arrival" | "burst", v: string) {
    onChange({
      ...value,
      processes: value.processes.map((p, j) =>
        j === i
          ? { ...p, [key]: key === "pid" ? v : v === "" ? NaN : Number(v) }
          : p,
      ),
    });
  }
  return (
    <fieldset disabled={disabled} className="schedule-input">
      <p>{algorithmRules[algorithm]}</p>
      <p>单 CPU；没有 I/O 和进程切换开销。输入时间采用同一单位。</p>
      <div className="toolbar">
        {exampleProcesses.map((ps, i) => (
          <button
            type="button"
            className="secondary"
            key={i}
            onClick={() =>
              onChange({ ...value, processes: structuredClone(ps) })
            }
          >
            示例 {i + 1}
            {i === 1 ? "（含空闲）" : i === 2 ? "（同时到达）" : ""}
          </button>
        ))}
      </div>
      {algorithm === "rr" && (
        <label className="quantum-field">
          时间片
          <input
            aria-label="时间片"
            type="number"
            min="0.000001"
            max="1000000"
            step="any"
            value={Number.isNaN(value.quantum) ? "" : value.quantum}
            onChange={(e) =>
              onChange({
                ...value,
                quantum: e.target.value === "" ? NaN : Number(e.target.value),
              })
            }
          />
        </label>
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>进程 ID</th>
              <th>到达时间</th>
              <th>运行时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {value.processes.map((p, i) => (
              <tr key={i}>
                <td>
                  <input
                    aria-label={`进程${i + 1}ID`}
                    maxLength={30}
                    value={p.pid}
                    onChange={(e) => edit(i, "pid", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`进程${i + 1}到达`}
                    type="number"
                    min="0"
                    max="1000000"
                    step="any"
                    value={Number.isNaN(p.arrival) ? "" : p.arrival}
                    onChange={(e) => edit(i, "arrival", e.target.value)}
                  />
                </td>
                <td>
                  <input
                    aria-label={`进程${i + 1}运行`}
                    type="number"
                    min="0.000001"
                    max="1000000"
                    step="any"
                    value={Number.isNaN(p.burst) ? "" : p.burst}
                    onChange={(e) => edit(i, "burst", e.target.value)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="danger"
                    disabled={value.processes.length === 1}
                    onClick={() =>
                      onChange({
                        ...value,
                        processes: value.processes.filter((_, j) => i !== j),
                      })
                    }
                  >
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className="secondary"
        disabled={value.processes.length >= 100}
        onClick={() => {
          let n = value.processes.length + 1;
          while (value.processes.some((p) => p.pid === `P${n}`)) n++;
          onChange({
            ...value,
            processes: [
              ...value.processes,
              { pid: `P${n}`, arrival: 0, burst: 1 },
            ],
          });
        }}
      >
        添加进程
      </button>
    </fieldset>
  );
}
export function validConfig(value: ScheduleConfig) {
  if (
    !Number.isFinite(value.quantum) ||
    value.quantum <= 0 ||
    value.quantum > 1000000
  )
    return "时间片应为大于0、不超过1000000的数值";
  if (
    !value.processes.length ||
    value.processes.some(
      (p) =>
        !p.pid.trim() ||
        !Number.isFinite(p.arrival) ||
        p.arrival < 0 ||
        p.arrival > 1000000 ||
        !Number.isFinite(p.burst) ||
        p.burst <= 0 ||
        p.burst > 1000000,
    ) ||
    new Set(value.processes.map((p) => p.pid.trim())).size !==
      value.processes.length
  )
    return "请检查空值、时间范围和重复进程 ID";
  return "";
}
export function SchedulePlayback({
  result,
  active = true,
}: {
  result: ScheduleResult;
  active?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setIndex(0);
    setPlaying(false);
  }, [result]);
  useEffect(() => {
    if (!active) setPlaying(false);
  }, [active]);
  useEffect(() => {
    if (!active || !playing) return;
    const timer = setInterval(
      () =>
        setIndex((i) => {
          if (i >= result.timeline.length - 1) {
            setPlaying(false);
            return i;
          }
          return i + 1;
        }),
      1000,
    );
    return () => clearInterval(timer);
  }, [active, playing, result]);
  const frame = result.timeline[Math.min(index, result.timeline.length - 1)];
  return (
    <section className="schedule-result">
      <h2>调度结果</h2>
      <p>
        {algorithmNames[result.algorithm]} · 引擎 {result.engine_version}
      </p>
      <div className="metrics">
        <b>平均等待 {result.average_waiting.toFixed(2)}</b>
        <b>平均周转 {result.average_turnaround.toFixed(2)}</b>
        <b>平均响应 {result.average_response.toFixed(2)}</b>
        <b>CPU 利用率 {(result.cpu_utilization * 100).toFixed(1)}%</b>
      </div>
      <div className="schedule-frame" aria-live="polite">
        <h3>{frame.pid}</h3>
        <p>
          {frame.start} → {frame.end}：{frame.reason}
        </p>
        <p>本段开始时其他就绪进程：{frame.ready.join("、") || "无"}</p>
        <small>
          后续到达的进程在调度边界加入；这是调度事件回放，不是逐时钟仿真。
        </small>
      </div>
      <div className="toolbar">
        <button
          className="secondary"
          disabled={index === 0}
          onClick={() => {
            setPlaying(false);
            setIndex((i) => i - 1);
          }}
        >
          上一步
        </button>
        <button
          className="secondary"
          disabled={index >= result.timeline.length - 1}
          onClick={() => {
            setPlaying(false);
            setIndex((i) => i + 1);
          }}
        >
          下一步
        </button>
        <button
          className="secondary"
          onClick={() => {
            if (index === result.timeline.length - 1) setIndex(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "暂停回放" : "自动回放"}
        </button>
        <button
          className="secondary"
          onClick={() => {
            setPlaying(false);
            setIndex(0);
          }}
        >
          重置回放
        </button>
        <span>
          事件 {index + 1} / {result.timeline.length}
        </span>
      </div>
      <label>
        定位调度事件
        <input
          aria-label="定位调度事件"
          type="range"
          min="0"
          max={result.timeline.length - 1}
          value={index}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Number(e.target.value));
          }}
        />
      </label>
      <div className="timeline" aria-label="甘特图">
        {result.timeline.map((t, i) => (
          <button
            key={i}
            className={
              (t.idle ? "idle" : "slot") + (index === i ? " active" : "")
            }
            style={{ flexGrow: t.end - t.start, flexBasis: 0, minWidth: 85 }}
            onClick={() => {
              setPlaying(false);
              setIndex(i);
            }}
          >
            <strong>{t.pid}</strong>
            <small>
              {t.start} → {t.end}
            </small>
          </button>
        ))}
      </div>
      <p>
        长时间轴可横向滚动；短区间保留最小宽度，比例仅作辅助。利用率以时刻0至最后完成计算。
      </p>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              {["进程", "首次开始", "完成", "等待", "周转", "响应"].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.results.map((p) => (
              <tr key={p.pid}>
                <td>{p.pid}</td>
                <td>{p.start}</td>
                <td>{p.completion}</td>
                <td>{p.waiting}</td>
                <td>{p.turnaround}</td>
                <td>{p.response}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
