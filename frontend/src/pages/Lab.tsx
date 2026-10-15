import { useState, FormEvent } from "react";
import { courseApi, Process, Schedule } from "../api";
import { Page, Notice } from "../components";
const examples: Process[][] = [
  [
    { pid: "P1", arrival: 0, burst: 4 },
    { pid: "P2", arrival: 1, burst: 3 },
    { pid: "P3", arrival: 2, burst: 1 },
  ],
  [
    { pid: "P1", arrival: 2, burst: 2 },
    { pid: "P2", arrival: 7, burst: 1 },
  ],
  [
    { pid: "P1", arrival: 0, burst: 3 },
    { pid: "P2", arrival: 0, burst: 2 },
    { pid: "P3", arrival: 0, burst: 1 },
  ],
];
export default function Lab() {
  const [processes, setProcesses] = useState(examples[0]);
  const [result, setResult] = useState<Schedule>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function change(index: number, key: keyof Process, value: string) {
    setResult(undefined);
    setProcesses((ps) =>
      ps.map((p, i) =>
        i === index
          ? {
              ...p,
              [key]: key === "pid" ? value : value === "" ? NaN : Number(value),
            }
          : p,
      ),
    );
  }
  async function run(e: FormEvent) {
    e.preventDefault();
    setError("");
    setResult(undefined);
    if (
      processes.some(
        (p) =>
          !p.pid.trim() ||
          !Number.isFinite(p.arrival) ||
          !Number.isFinite(p.burst) ||
          p.arrival < 0 ||
          p.burst <= 0,
      ) ||
      new Set(processes.map((p) => p.pid.trim())).size !== processes.length
    ) {
      setError("请检查空值、负数、运行时间及重复进程 ID");
      return;
    }
    setBusy(true);
    try {
      setResult(await courseApi.fcfs(processes));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page title="算法实验 · FCFS">
      <section className="panel">
        <h2>先来先服务 / 非抢占调度</h2>
        <p>
          按到达时间排序；同时到达时按输入顺序。等待时间 = 开始 − 到达；周转时间
          = 完成 − 到达。单位自行统一。
        </p>
        <div className="toolbar">
          {examples.map((e, i) => (
            <button
              className="secondary"
              key={i}
              onClick={() => {
                setProcesses(e.map((p) => ({ ...p })));
                setResult(undefined);
                setError("");
              }}
            >
              示例 {i + 1}
              {i === 1 ? "（含空闲）" : i === 2 ? "（同时到达）" : ""}
            </button>
          ))}
        </div>
        <form onSubmit={run}>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>进程 ID</th>
                  <th>到达时间</th>
                  <th>运行时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {processes.map((p, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        aria-label={`进程${i + 1}ID`}
                        required
                        maxLength={30}
                        value={p.pid}
                        onChange={(e) => change(i, "pid", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`进程${i + 1}到达`}
                        type="number"
                        step="any"
                        min="0"
                        max="1000000"
                        required
                        value={Number.isNaN(p.arrival) ? "" : p.arrival}
                        onChange={(e) => change(i, "arrival", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`进程${i + 1}运行`}
                        type="number"
                        step="any"
                        min="0.000001"
                        max="1000000"
                        required
                        value={Number.isNaN(p.burst) ? "" : p.burst}
                        onChange={(e) => change(i, "burst", e.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="danger"
                        disabled={processes.length === 1}
                        onClick={() => {
                          setProcesses((ps) => ps.filter((_, j) => j !== i));
                          setResult(undefined);
                        }}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={processes.length >= 100}
              onClick={() => {
                setProcesses((ps) => [
                  ...ps,
                  { pid: "", arrival: 0, burst: 1 },
                ]);
                setResult(undefined);
              }}
            >
              添加进程
            </button>
            <button disabled={busy}>{busy ? "计算中…" : "运行 FCFS"}</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setProcesses(examples[0].map((p) => ({ ...p })));
                setResult(undefined);
                setError("");
              }}
            >
              重置
            </button>
          </div>
        </form>
        <Notice error={error} />
      </section>
      {result && (
        <section className="panel spaced">
          <h2>调度结果</h2>
          <div className="metrics">
            <b>平均等待 {result.average_waiting.toFixed(2)}</b>
            <b>平均周转 {result.average_turnaround.toFixed(2)}</b>
          </div>
          <div className="timeline" aria-label="甘特图">
            {result.timeline.map((t, i) => (
              <div
                key={i}
                className={t.idle ? "idle" : "slot"}
                style={{
                  flexGrow: t.end - t.start,
                  flexBasis: 0,
                  minWidth: 85,
                }}
              >
                <strong>{t.pid}</strong>
                <small>
                  {t.start} → {t.end}
                </small>
              </div>
            ))}
          </div>
          <p>时间轴按时长比例绘制；极短区间保留最小宽度以便阅读。</p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  {["进程", "开始", "完成", "等待", "周转"].map((t) => (
                    <th key={t}>{t}</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Page>
  );
}
