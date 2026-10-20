import { Process, request, Schedule } from "./api";
export type Algorithm = "fcfs" | "sjf" | "rr";
export const algorithmNames: Record<Algorithm, string> = {
  fcfs: "FCFS 先来先服务",
  sjf: "SJF 短作业优先",
  rr: "RR 时间片轮转",
};
export const algorithmRules: Record<Algorithm, string> = {
  fcfs: "非抢占：按到达时间服务，同时到达时按输入顺序。",
  sjf: "非抢占：每次从当前就绪进程中选择运行时间最短者；同长度先到达，再按输入顺序。不预测未来到达的进程。",
  rr: "按就绪队列轮转，每次最多运行一个时间片；时间片结束时，新到达者先入队，再把未完成进程放到队尾。",
};
export interface ScheduleConfig {
  processes: Process[];
  quantum: number;
}
export interface ScheduleResult extends Schedule {
  results: (Schedule["results"][number] & { response: number })[];
  algorithm: Algorithm;
  engine_version: string;
  quantum: number;
  average_response: number;
  cpu_utilization: number;
  elapsed: number;
  timeline: (Schedule["timeline"][number] & {
    reason: string;
    ready: string[];
  })[];
}
export interface Experiment {
  id?: number;
  title: string;
  algorithm: Algorithm;
  chapter_id: number;
  knowledge_ids: number[];
  objectives: string;
  instructions: string;
  tasks: string;
  reference: string;
  defaults: ScheduleConfig;
  edit_version: number;
  revision_id?: number;
  published?: boolean;
  has_unpublished_changes?: boolean;
  related?: { id: number; chapter_id: number; title: string }[];
}
export interface RunSummary {
  id: number;
  experiment_id: number;
  revision_id: number;
  created_at: string;
  completed_at: string | null;
  observation: string;
}
export interface ExperimentRun extends RunSummary {
  input: ScheduleConfig;
  result: ScheduleResult;
  experiment: Experiment;
}
export const exampleProcesses: Process[][] = [
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
export function blankExperiment(
  chapter_id: number,
  algorithm: Algorithm = "fcfs",
): Experiment {
  return {
    title: algorithmNames[algorithm] + "（演示实验）",
    algorithm,
    chapter_id,
    knowledge_ids: [],
    objectives: "理解调度规则，区分等待时间、响应时间和周转时间。",
    instructions:
      "先预测执行顺序，再运行实验；逐步查看时间轴，核对各进程的指标。",
    tasks:
      "说明本组数据的调度顺序，并解释哪个进程等待最久。修改一项输入，观察结果如何变化。",
    reference:
      "等待时间 = 完成 − 到达 − 运行；周转时间 = 完成 − 到达；响应时间 = 首次开始 − 到达。观察不等于掌握。",
    defaults: { processes: structuredClone(exampleProcesses[0]), quantum: 2 },
    edit_version: 0,
  };
}
export const experimentApi = {
  list: (knowledge?: number, algorithm?: string) =>
    request<Experiment[]>(
      `/experiments?${new URLSearchParams({ ...(knowledge ? { knowledge_id: String(knowledge) } : {}), ...(algorithm ? { algorithm } : {}) })}`,
    ),
  detail: (id: number) => request<Experiment>(`/experiments/${id}`),
  teacherList: () => request<Experiment[]>("/teacher/experiments"),
  teacherDetail: (id: number) =>
    request<Experiment>(`/teacher/experiments/${id}`),
  save: (form: Experiment) => {
    const {
      id,
      revision_id,
      published,
      has_unpublished_changes,
      related,
      ...body
    } = form;
    return request<Experiment>(`/teacher/experiments${id ? "/" + id : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(body),
    });
  },
  action: (form: Experiment, action: "preview" | "publish" | "withdraw") =>
    request<Experiment | ScheduleResult>(
      `/teacher/experiments/${form.id}/${action}`,
      {
        method: "POST",
        body: JSON.stringify({ edit_version: form.edit_version }),
      },
    ),
  run: (form: Experiment, config: ScheduleConfig) =>
    request<{ id: number; revision_id: number; result: ScheduleResult }>(
      `/experiments/${form.id}/runs`,
      {
        method: "POST",
        body: JSON.stringify({ ...config, revision_id: form.revision_id }),
      },
    ),
  runs: (id?: number) =>
    request<RunSummary[]>(
      `/my/experiment-runs${id ? "?experiment_id=" + id : ""}`,
    ),
  readRun: (id: number) => request<ExperimentRun>(`/my/experiment-runs/${id}`),
  observe: (id: number, observation: string) =>
    request<{ message: string }>(`/my/experiment-runs/${id}/observation`, {
      method: "PUT",
      body: JSON.stringify({ observation }),
    }),
};
