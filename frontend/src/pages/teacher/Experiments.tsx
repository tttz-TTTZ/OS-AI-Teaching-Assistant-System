import { useEffect, useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { Chapter, teacherApi } from "../../api";
import { Content, digitalApi } from "../../digital";
import {
  Algorithm,
  algorithmNames,
  blankExperiment,
  Experiment,
  experimentApi,
  ScheduleResult,
} from "../../experiments";
import { Notice } from "../../components";
import Markdown from "../../Markdown";
import {
  ProcessEditor,
  SchedulePlayback,
  validConfig,
} from "../../learning/ScheduleWorkbench";
import { AuthoringPage } from "./Authoring";
import { useAuth } from "../../auth";

export function TeacherExperiments() {
  const [items, setItems] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    experimentApi
      .teacherList()
      .then((rows) => {
        if (active) setItems(rows);
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
  return (
    <AuthoringPage
      title="算法实验管理"
      description="先选择已有算法模板，再配置教学任务。试运行确认后才发布给学生。"
    >
      <Link className="button" to="/teacher/experiments/new">
        ＋ 新建教学实验
      </Link>
      <Notice error={error} />
      <div className="experiment-list">
        {items.map((p) => (
          <section className="authoring-card experiment-card" key={p.id}>
            <span className="badge">{algorithmNames[p.algorithm]}</span>
            <h2>{p.title}</h2>
            <p>
              {p.published
                ? p.has_unpublished_changes
                  ? "已有发布版本 · 有未发布修改"
                  : "已发布"
                : "草稿 · 学生不可见"}
            </p>
            <div className="row-actions">
              <Link
                className="button"
                to={`/teacher/experiments/${p.id}/teaching`}
              >
                编写教学任务
              </Link>
              <Link to={`/teacher/experiments/${p.id}/config`}>
                修改示例输入
              </Link>
              <Link to={`/teacher/experiments/${p.id}/preview`}>
                试运行与发布 →
              </Link>
            </div>
          </section>
        ))}
      </div>
      {loading ? (
        <p role="status">正在读取实验…</p>
      ) : (
        !items.length &&
        !error && (
          <p>
            尚未建立教学实验。先选择 FCFS、SJF 或 RR
            模板，示例均标为演示，可自由修改。
          </p>
        )
      )}
      <p>
        新增算法计算规则需要开发并测试程序；教师在这里维护教学说明、输入和任务，不上传执行代码。
      </p>
    </AuthoringPage>
  );
}
const steps = [
  ["template", "模板与归属"],
  ["teaching", "教学任务"],
  ["config", "示例输入"],
  ["preview", "试运行与发布"],
] as const;
export default function ExperimentEditor() {
  const { experimentId, step = "template" } = useParams();
  const id = Number(experimentId);
  const creating = !id;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form, setForm] = useState<Experiment>();
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [points, setPoints] = useState<Content[]>([]);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<ScheduleResult>();
  const [previewRevision, setPreviewRevision] = useState<number>();
  const generation = useRef(0);
  const loadedKey = useRef("");
  const key = `os:experiment-draft:${user?.id}:${id || "new"}`;
  useEffect(() => {
    let active = true;
    generation.current++;
    loadedKey.current = "";
    setLoading(true);
    setForm(undefined);
    setError("");
    setMessage("");
    setBusy(false);
    setDirty(false);
    setResult(undefined);
    setPreviewRevision(undefined);
    Promise.all([
      teacherApi.chapters(),
      digitalApi.teacherList(),
      creating ? Promise.resolve(undefined) : experimentApi.teacherDetail(id),
    ])
      .then(([cs, ps, saved]) => {
        if (!active) return;
        setChapters(cs);
        setPoints(ps);
        const point = ps.find((p) => p.id === Number(params.get("knowledge")));
        const initial = saved || {
          ...blankExperiment(point?.chapter_id || cs[0]?.id || 0),
          knowledge_ids: point?.id ? [point.id] : [],
        };
        loadedKey.current = key;
        try {
          const local = JSON.parse(
            sessionStorage.getItem(key) || "null",
          ) as Experiment | null;
          if (local) {
            setForm(local);
            setDirty(true);
            setMessage("已恢复本标签未保存的实验草稿");
            if (saved && saved.edit_version !== local.edit_version)
              setError("服务器已有更新，请先复制需要保留的内容，再重新读取。");
            return;
          }
        } catch {
          /* 读取数据库仍可继续。 */
        }
        setForm(initial);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current++;
    };
  }, [id, key]);
  useEffect(() => {
    if (dirty && form && loadedKey.current === key) {
      try {
        sessionStorage.setItem(key, JSON.stringify(form));
      } catch {
        setMessage("浏览器不能暂存，请及时保存草稿。");
      }
    }
  }, [dirty, form, key]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  function change(next: Experiment) {
    setForm(next);
    setDirty(true);
    setMessage("");
    setResult(undefined);
    setPreviewRevision(undefined);
  }
  async function save() {
    if (!form || busy) return;
    if (!creating && !dirty) return form;
    const failure = validConfig(form.defaults);
    if (failure) {
      setError(failure);
      return;
    }
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const saved = await experimentApi.save(form);
      if (token !== generation.current) return;
      setForm(saved);
      setDirty(false);
      setMessage("实验草稿已保存，尚未自动发布");
      try {
        sessionStorage.removeItem(key);
      } catch {}
      return saved;
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function go(next: string) {
    const saved = await save();
    if (saved) {
      navigate(`/teacher/experiments/${saved.id}/${next}`);
      window.scrollTo(0, 0);
    }
  }
  async function action(kind: "preview" | "publish" | "withdraw") {
    const saved = await save();
    if (!saved) return;
    const token = generation.current;
    setBusy(true);
    setError("");
    try {
      const response = await experimentApi.action(saved, kind);
      if (token !== generation.current) return;
      if (kind === "preview") {
        setResult(response as ScheduleResult);
        setPreviewRevision(saved.revision_id);
        setMessage("当前草稿试运行成功，请检查结果后发布");
      } else {
        setForm(response as Experiment);
        setMessage(
          kind === "publish"
            ? "实验已发布，学生可从实验库或关联知识点进入"
            : "实验已撤回；本人历史运行记录保留",
        );
      }
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function reload() {
    if (dirty && !confirm("放弃本页未保存编辑？请先复制要保留的内容。")) return;
    setBusy(true);
    try {
      const fresh = creating
        ? blankExperiment(chapters[0]?.id || 0)
        : await experimentApi.teacherDetail(id);
      setForm(fresh);
      setDirty(false);
      setError("");
      setMessage("已重新读取草稿");
      setResult(undefined);
      setPreviewRevision(undefined);
      try {
        sessionStorage.removeItem(key);
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const activeStep = creating
    ? "template"
    : steps.some(([s]) => s === step)
      ? step
      : "template";
  const stepIndex = steps.findIndex(([s]) => s === activeStep);
  return (
    <AuthoringPage
      title={
        creating ? "选择算法，建立教学实验" : form?.title || "编辑教学实验"
      }
      description="教师编辑教学内容与示例；算法计算由后端统一执行。"
    >
      <div className="editor-topbar">
        <button
          className="text-button"
          disabled={busy}
          onClick={async () => {
            if (!dirty || (await save())) navigate("/teacher/experiments");
          }}
        >
          ← 返回实验列表
        </button>
        <span>
          {dirty ? "有未保存修改" : form?.published ? "已有发布版本" : "草稿"}
        </span>
        <div className="row-actions">
          <button
            className="secondary"
            disabled={busy || creating || !dirty}
            onClick={() => void save()}
          >
            保存实验草稿
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void reload()}
          >
            重新读取
          </button>
        </div>
      </div>
      <nav
        className="authoring-steps experiment-steps"
        aria-label="实验编写步骤"
      >
        {steps.map(([s, label], i) => (
          <button
            key={s}
            className={activeStep === s ? "current" : ""}
            aria-current={activeStep === s ? "step" : undefined}
            disabled={busy || creating}
            onClick={() => void go(s)}
          >
            <span>{i + 1}</span>
            {label}
          </button>
        ))}
      </nav>
      <Notice error={error} />
      {message && (
        <p role="status" className="feedback">
          {message}
        </p>
      )}
      {loading ? (
        <p role="status">正在加载实验…</p>
      ) : form ? (
        <>
          <fieldset className="authoring-editor" disabled={busy}>
            {activeStep === "template" && (
              <section className="authoring-card authoring-form">
                <h2>模板与课程归属</h2>
                <label>
                  算法模板
                  <select
                    aria-label="算法模板"
                    value={form.algorithm}
                    onChange={(e) =>
                      change({
                        ...form,
                        algorithm: e.target.value as Algorithm,
                        title:
                          form.title ===
                          algorithmNames[form.algorithm] + "（演示实验）"
                            ? algorithmNames[e.target.value as Algorithm] +
                              "（演示实验）"
                            : form.title,
                      })
                    }
                  >
                    {Object.entries(algorithmNames).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  实验标题
                  <input
                    aria-label="实验标题"
                    maxLength={200}
                    value={form.title}
                    onChange={(e) => change({ ...form, title: e.target.value })}
                  />
                </label>
                <label>
                  所属章节
                  <select
                    aria-label="所属章节"
                    value={form.chapter_id}
                    onChange={(e) =>
                      change({ ...form, chapter_id: Number(e.target.value) })
                    }
                  >
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                        {c.published ? "" : "（未发布）"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  关联知识点（可多选）
                  <select
                    multiple
                    aria-label="关联知识点（可多选）"
                    size={Math.min(Math.max(points.length, 3), 8)}
                    value={form.knowledge_ids.map(String)}
                    onChange={(e) =>
                      change({
                        ...form,
                        knowledge_ids: Array.from(
                          e.target.selectedOptions,
                          (o) => Number(o.value),
                        ),
                      })
                    }
                  >
                    {points
                      .filter((p) => !p.archived)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} {p.title}
                        </option>
                      ))}
                  </select>
                </label>
                <p>
                  关联后学生在知识点页面会看到本实验入口。知识点是否可见仍由知识点自己的发布状态决定。
                </p>
                {creating && (
                  <button onClick={() => void go("teaching")}>
                    建立实验草稿 →
                  </button>
                )}
              </section>
            )}
            {activeStep === "teaching" && (
              <section className="authoring-card authoring-form">
                <h2>学生先读什么、观察什么？</h2>
                <p>支持基础 Markdown。默认文字是演示提示，请按实际教案修订。</p>
                {(
                  [
                    ["objectives", "学习目标"],
                    ["instructions", "操作说明"],
                    ["tasks", "观察任务"],
                    ["reference", "参考说明"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k}>
                    {label}
                    <textarea
                      aria-label={label}
                      maxLength={k === "objectives" ? 5000 : 10000}
                      rows={k === "objectives" ? 5 : 8}
                      value={form[k]}
                      onChange={(e) => change({ ...form, [k]: e.target.value })}
                    />
                  </label>
                ))}
              </section>
            )}
            {activeStep === "config" && (
              <section className="authoring-card">
                <h2>准备一组学生可以直接运行的输入</h2>
                <ProcessEditor
                  value={form.defaults}
                  algorithm={form.algorithm}
                  onChange={(defaults) => change({ ...form, defaults })}
                />
                <p>
                  学生进入时载入这组输入，也可以自己调整。一次最多100个进程，RR最多2000段调度事件。
                </p>
              </section>
            )}
            {activeStep === "preview" && (
              <>
                <section className="authoring-card">
                  <h2>学生任务预览</h2>
                  <h3>学习目标</h3>
                  <Markdown content={form.objectives} />
                  <h3>操作说明</h3>
                  <Markdown content={form.instructions} />
                  <h3>观察任务</h3>
                  <Markdown content={form.tasks} />
                  <details>
                    <summary>参考说明</summary>
                    <Markdown content={form.reference} />
                  </details>
                  <p>
                    {algorithmNames[form.algorithm]} ·{" "}
                    {form.defaults.processes.length} 个进程
                    {form.algorithm === "rr"
                      ? ` · 时间片 ${form.defaults.quantum}`
                      : ""}
                  </p>
                  <button onClick={() => void action("preview")}>
                    试运行当前草稿
                  </button>
                </section>
                {result && (
                  <section className="authoring-card">
                    <SchedulePlayback result={result} />
                  </section>
                )}
                <section className="authoring-card">
                  <h2>确认后发布</h2>
                  <p>
                    需填写目标、操作说明和观察任务，所属课程与章节已发布，并试运行当前草稿。修改后必须重新试运行。
                  </p>
                  <div className="row-actions">
                    <button
                      disabled={
                        dirty || !result || previewRevision !== form.revision_id
                      }
                      onClick={() => void action("publish")}
                    >
                      发布教学实验
                    </button>
                    {form.published && (
                      <button
                        className="danger"
                        onClick={() => {
                          if (
                            confirm(
                              "撤回后学生不能继续运行此实验，历史记录保留。确定撤回？",
                            )
                          )
                            void action("withdraw");
                        }}
                      >
                        撤回教学实验
                      </button>
                    )}
                  </div>
                </section>
              </>
            )}
          </fieldset>
          {!creating && (
            <div className="authoring-bottom">
              {stepIndex > 0 && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void go(steps[stepIndex - 1][0])}
                >
                  上一步
                </button>
              )}
              {stepIndex < 3 && (
                <button
                  disabled={busy}
                  onClick={() => void go(steps[stepIndex + 1][0])}
                >
                  保存并继续：{steps[stepIndex + 1][1]} →
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <p>未找到可编辑的实验，请返回列表。</p>
      )}
    </AuthoringPage>
  );
}
