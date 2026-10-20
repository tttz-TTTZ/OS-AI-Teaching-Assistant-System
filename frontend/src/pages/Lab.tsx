import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Notice, useChapters } from "../components";
import {
  Algorithm,
  algorithmNames,
  Experiment,
  experimentApi,
  ExperimentRun,
  RunSummary,
  ScheduleConfig,
  ScheduleResult,
} from "../experiments";
import {
  ProcessEditor,
  SchedulePlayback,
  validConfig,
} from "../learning/ScheduleWorkbench";
import Markdown from "../Markdown";
import { useAuth } from "../auth";

export default function Lab() {
  const { experimentId } = useParams();
  const id = Number(experimentId);
  return id ? <ExperimentLesson key={id} id={id} /> : <ExperimentLibrary />;
}
function ExperimentLibrary() {
  const { chapters, error: chapterError } = useChapters();
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<Experiment[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([experimentApi.list(), experimentApi.runs()])
      .then(([ps, rs]) => {
        if (active) {
          setItems(ps);
          setRuns(rs);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const visible = items.filter(
    (p) =>
      (!params.get("algorithm") || p.algorithm === params.get("algorithm")) &&
      (!params.get("chapter") ||
        p.chapter_id === Number(params.get("chapter"))) &&
      p.title.includes(query),
  );
  function filter(key: string, value: string) {
    setParams((p) => {
      const next = new URLSearchParams(p);
      value ? next.set(key, value) : next.delete(key);
      return next;
    });
  }
  return (
    <div className="study-workspace experiment-workspace">
      <header className="study-heading">
        <span>ALGORITHM LAB / 算法实验</span>
        <h1>选一个实验，动手验证原理</h1>
        <p>
          先读任务，再调整输入运行；用过程回放解释结果，最后记录自己的观察。
        </p>
      </header>
      <Notice error={error || chapterError} />
      <section className="study-card experiment-filters">
        <label>
          算法
          <select
            aria-label="筛选算法"
            value={params.get("algorithm") || ""}
            onChange={(e) => filter("algorithm", e.target.value)}
          >
            <option value="">全部算法</option>
            {Object.entries(algorithmNames).map(([k, n]) => (
              <option key={k} value={k}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          章节
          <select
            aria-label="筛选实验章节"
            value={params.get("chapter") || ""}
            onChange={(e) => filter("chapter", e.target.value)}
          >
            <option value="">全部章节</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          查找实验
          <input
            aria-label="查找实验"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入实验标题"
          />
        </label>
      </section>
      {loading ? (
        <p role="status">正在加载实验库…</p>
      ) : (
        <div className="experiment-list">
          {visible.map((p) => (
            <section className="study-card experiment-card" key={p.id}>
              <span className="badge">{algorithmNames[p.algorithm]}</span>
              <h2>{p.title}</h2>
              <p>
                {chapters.find((c) => c.id === p.chapter_id)?.title ||
                  "课程实验"}{" "}
                · 默认 {p.defaults.processes.length} 个进程
              </p>
              <Markdown content={p.objectives} />
              <Link className="button" to={`/student/experiments/${p.id}`}>
                进入实验 →
              </Link>
            </section>
          ))}
          {!visible.length && !error && (
            <section className="study-card">
              <h2>{items.length ? "没有匹配的实验" : "暂无已发布实验"}</h2>
              <p>
                {items.length
                  ? "可以更换筛选条件。"
                  : "教师发布教学实验后会显示在这里；知识点中的概念演示仍可正常学习。"}
              </p>
            </section>
          )}
        </div>
      )}
      <section className="study-card">
        <h2>我的最近运行</h2>
        <p>
          运行与完成观察分开记录。历史输入和结果可重新查看，不等于已经掌握。
        </p>
        {runs.map((r) => (
          <p className="experiment-run-row" key={r.id}>
            <Link to={`/student/experiment-runs/${r.id}`}>
              运行 #{r.id} · {r.completed_at ? "已保存观察" : "待记录观察"} →
            </Link>
            <small>{r.created_at} UTC</small>
          </p>
        ))}
        {!runs.length && <p>暂无运行记录，从一个已发布实验开始。</p>}
      </section>
    </div>
  );
}
function ExperimentLesson({ id }: { id: number }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const view =
    params.get("view") === "run"
      ? "run"
      : params.get("view") === "record"
        ? "record"
        : "intro";
  const [experiment, setExperiment] = useState<Experiment>();
  const [config, setConfig] = useState<ScheduleConfig>();
  const [result, setResult] = useState<ScheduleResult>();
  const [runId, setRunId] = useState<number>();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [observation, setObservation] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [inputChanged, setInputChanged] = useState(false);
  const alive = useRef(true);
  const cacheKey = `os:experiment-input:${user?.id}:${id}`;
  useEffect(() => {
    let active = true;
    alive.current = true;
    Promise.all([experimentApi.detail(id), experimentApi.runs(id)])
      .then(([p, rs]) => {
        if (!active) return;
        setExperiment(p);
        setRuns(rs);
        setConfig(structuredClone(p.defaults));
        try {
          const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
          if (cached?.revision === p.revision_id) {
            setConfig(cached.config);
            setInputChanged(true);
            setMessage("已恢复本标签的输入；请重新运行以生成结果。");
          }
        } catch {
          /* 数据库仍可读取。 */
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      alive.current = false;
    };
  }, [id]);
  useEffect(() => {
    if (inputChanged && config && experiment) {
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({ revision: experiment.revision_id, config }),
        );
      } catch {
        setMessage("浏览器不能暂存输入，请勿直接关闭页面。");
      }
    }
  }, [inputChanged, config, experiment, cacheKey]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (dirty && runId) {
      try {
        sessionStorage.setItem(
          `os:experiment-observation:${user?.id}:${runId}`,
          observation,
        );
      } catch {
        setMessage("浏览器不能暂存观察，请及时保存。");
      }
    }
  }, [dirty, runId, observation, user?.id]);
  function go(next: string) {
    setParams((p) => {
      const nextParams = new URLSearchParams(p);
      nextParams.set("view", next);
      return nextParams;
    });
    window.scrollTo(0, 0);
  }
  function change(next: ScheduleConfig) {
    setConfig(next);
    setInputChanged(true);
    setMessage(
      "",
    ); /* Keep the previous result and observation clearly labelled until the next successful run. */
  }
  async function run() {
    if (!experiment || !config || busy) return;
    const failure = validConfig(config);
    if (failure) {
      setError(failure);
      return;
    }
    if (
      dirty &&
      !confirm(
        "当前观察尚未保存，先保存后再运行可保留它。仍要开始新一次运行吗？",
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await experimentApi.run(experiment, config);
      if (!alive.current) return;
      setResult(response.result);
      setRunId(response.id);
      setObservation("");
      setDirty(false);
      setInputChanged(false);
      setMessage("运行已保存，可回放过程并记录观察");
      setRuns(await experimentApi.runs(id));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function saveObservation() {
    if (!runId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await experimentApi.observe(runId, observation);
      if (!alive.current) return;
      setDirty(false);
      try {
        sessionStorage.removeItem(
          `os:experiment-observation:${user?.id}:${runId}`,
        );
      } catch {}
      setMessage(response.message);
      setRuns(await experimentApi.runs(id));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function leave(to: string) {
    if (busy || (dirty && !confirm("观察尚未保存，确定离开？"))) return;
    navigate(to);
  }
  const point = experiment?.related?.find(
    (p) => p.id === Number(params.get("from")),
  );
  const returnTo = point
    ? `/student/knowledge?chapter=${point.chapter_id}&point=${point.id}&block=${encodeURIComponent(params.get("block") || "overview")}`
    : undefined;
  return (
    <div className="study-workspace experiment-workspace">
      <div className="study-breadcrumb">
        <button
          className="text-button"
          disabled={busy}
          onClick={() => leave("/student/experiments")}
        >
          ← 返回实验库
        </button>
        {returnTo && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => leave(returnTo)}
          >
            返回原知识点 →
          </button>
        )}
      </div>
      <Notice error={error} />
      {loading ? (
        <p role="status">正在读取实验…</p>
      ) : experiment && config ? (
        <>
          <header className="study-heading study-lesson-heading">
            <span>{algorithmNames[experiment.algorithm]}</span>
            <h1>{experiment.title}</h1>
            <p>按任务完成一次“预测 → 运行 → 解释”，也可以自由切换步骤。</p>
          </header>
          <nav className="study-tabs" aria-label="实验学习步骤">
            {[
              ["intro", "1 阅读任务"],
              ["run", "2 动手运行"],
              ["record", "3 观察与记录"],
            ].map(([k, label]) => (
              <button
                key={k}
                className={view === k ? "selected" : ""}
                aria-current={view === k ? "step" : undefined}
                disabled={busy}
                onClick={() => go(k)}
              >
                {label}
              </button>
            ))}
          </nav>
          {message && (
            <p role="status" className="study-status">
              {message}
            </p>
          )}
          {view === "intro" && (
            <section className="study-card">
              <h2>学习目标</h2>
              <Markdown content={experiment.objectives} />
              <h2>操作说明</h2>
              <Markdown content={experiment.instructions} />
              <h2>观察任务</h2>
              <Markdown content={experiment.tasks} />
              <p>
                单 CPU 教学模型，没有 I/O
                或切换开销。教师设定的是初始输入，可以自行调整。
              </p>
              <button onClick={() => go("run")}>读完任务，开始实验 →</button>
            </section>
          )}
          <div hidden={view !== "run"}>
            <section className="study-card">
              <h2>调整输入并运行</h2>
              <ProcessEditor
                value={config}
                algorithm={experiment.algorithm}
                onChange={change}
                disabled={busy}
              />
              <div className="toolbar spaced">
                <button disabled={busy} onClick={() => void run()}>
                  {busy
                    ? "计算中…"
                    : `运行 ${experiment.algorithm.toUpperCase()}`}
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => change(structuredClone(experiment.defaults))}
                >
                  恢复教师示例
                </button>
                <button className="secondary" onClick={() => go("intro")}>
                  查看任务
                </button>
              </div>
            </section>
            {result && (
              <section className="study-card">
                {inputChanged && (
                  <p className="notice">
                    输入已修改，下方仍是上一次运行结果。请重新运行后再比较。
                  </p>
                )}
                <SchedulePlayback result={result} active={view === "run"} />
                <button disabled={busy} onClick={() => go("record")}>
                  分析结果，记录观察 →
                </button>
              </section>
            )}
          </div>
          {view === "record" && (
            <>
              <section className="study-card study-notes">
                <h2>记录本次实验观察</h2>
                <Markdown content={experiment.tasks} />
                {runId ? (
                  <>
                    <p>
                      对应运行 #{runId}
                      {inputChanged
                        ? "；输入已修改，但尚未重新运行。这里仍记录上一次结果。"
                        : ""}
                    </p>
                    <label>
                      我的实验观察
                      <textarea
                        aria-label="我的实验观察"
                        disabled={busy}
                        maxLength={5000}
                        rows={10}
                        value={observation}
                        onChange={(e) => {
                          setObservation(e.target.value);
                          setDirty(true);
                          setMessage("");
                        }}
                        placeholder="解释执行顺序、等待时间及你发现的现象。"
                      />
                    </label>
                    <button
                      disabled={busy || !observation.trim()}
                      onClick={() => void saveObservation()}
                    >
                      保存实验观察
                    </button>
                    <p>
                      观察仅本人可见。提交观察代表记录已完成，不自动判断答案正确或已经掌握。
                    </p>
                  </>
                ) : (
                  <>
                    <p>请先完成一次运行，再针对实际结果记录观察。</p>
                    <button onClick={() => go("run")}>先去运行 →</button>
                  </>
                )}
                <details>
                  <summary>查看参考说明</summary>
                  <Markdown
                    content={experiment.reference || "教师尚未提供参考说明"}
                  />
                </details>
              </section>
              <section className="study-card">
                <h2>本实验的运行记录</h2>
                {runs.map((r) => (
                  <p key={r.id}>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => leave(`/student/experiment-runs/${r.id}`)}
                    >
                      运行 #{r.id} ·{" "}
                      {r.completed_at ? "已保存观察" : "待记录观察"} →
                    </button>
                  </p>
                ))}
                {!runs.length && <p>暂无记录</p>}
              </section>
            </>
          )}
          {view === "intro" && !!experiment.related?.length && (
            <section className="study-card">
              <h2>相关知识点</h2>
              {experiment.related.map((p) => (
                <p key={p.id}>
                  <button
                    className="text-button"
                    onClick={() =>
                      leave(
                        `/student/knowledge?chapter=${p.chapter_id}&point=${p.id}`,
                      )
                    }
                  >
                    {p.title} →
                  </button>
                </p>
              ))}
            </section>
          )}
        </>
      ) : (
        <section className="study-card">
          <h1>暂时无法打开这个实验</h1>
          <p>
            实验可能未发布、已撤回或所属章节不可见。历史运行可在实验库中查看。
          </p>
          <button onClick={() => leave("/student/experiments")}>
            返回实验库
          </button>
        </section>
      )}
    </div>
  );
}
export function ExperimentRunPage() {
  const { runId } = useParams();
  const { user } = useAuth();
  const cacheKey = `os:experiment-observation:${user?.id}:${runId}`;
  const loadedKey = useRef("");
  const [run, setRun] = useState<ExperimentRun>();
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    setRun(undefined);
    loadedKey.current = "";
    setDirty(false);
    setMessage("");
    setError("");
    experimentApi
      .readRun(Number(runId))
      .then((r) => {
        if (active) {
          setRun(r);
          loadedKey.current = cacheKey;
          let cached: string | null = null;
          try {
            cached = sessionStorage.getItem(cacheKey);
          } catch {}
          setNote(cached ?? r.observation);
          setDirty(cached !== null);
          if (cached !== null)
            setMessage("已恢复本标签未保存的实验观察，请检查后保存");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [runId, user?.id]);
  useEffect(() => {
    if (dirty && loadedKey.current === cacheKey) {
      try {
        sessionStorage.setItem(cacheKey, note);
      } catch {
        setMessage("浏览器不能暂存观察，请及时保存。");
      }
    }
  }, [dirty, note, cacheKey]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  return (
    <div className="study-workspace experiment-workspace">
      <header className="study-heading">
        <h1>我的实验运行 #{runId}</h1>
        <p>
          这里使用运行时的输入、教学版本和结果，教师后续修改或撤回不会覆盖它。
        </p>
      </header>
      <Link
        to="/student/experiments"
        onClick={(e) => {
          if (dirty && !confirm("观察尚未保存，确定离开？")) e.preventDefault();
        }}
      >
        ← 返回实验库
      </Link>
      <Notice error={error} />
      {message && <p role="status">{message}</p>}
      {run && (
        <>
          <section className="study-card">
            <h2>{run.experiment.title}</h2>
            <p>
              教学修订 #{run.revision_id} · {run.created_at} UTC
            </p>
            <details>
              <summary>查看当时的任务与输入</summary>
              <Markdown content={run.experiment.tasks} />
              <div className="tablewrap">
                <table>
                  <thead>
                    <tr>
                      <th>进程</th>
                      <th>到达</th>
                      <th>运行</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.input.processes.map((p) => (
                      <tr key={p.pid}>
                        <td>{p.pid}</td>
                        <td>{p.arrival}</td>
                        <td>{p.burst}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {run.experiment.algorithm === "rr" && (
                <p>时间片 {run.input.quantum}</p>
              )}
            </details>
          </section>
          <section className="study-card">
            <SchedulePlayback result={run.result} />
          </section>
          <section className="study-card study-notes">
            <label>
              我的实验观察
              <textarea
                aria-label="我的实验观察"
                maxLength={5000}
                value={note}
                disabled={busy}
                onChange={(e) => {
                  setNote(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            <button
              disabled={busy || !note.trim()}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const response = await experimentApi.observe(run.id, note);
                  setMessage(response.message);
                  setDirty(false);
                  try {
                    sessionStorage.removeItem(cacheKey);
                  } catch {}
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存实验观察
            </button>
          </section>
        </>
      )}
    </div>
  );
}
