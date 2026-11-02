export type Template =
  | "memory"
  | "timeshare"
  | "printer"
  | "layers"
  | "perspectives"
  | "goals"
  | "resources"
  | "roles"
  | "concurrency"
  | "race"
  | "async"
  | "history";
export const templates: Record<Template, string> = {
  memory: "空分内存分配",
  timeshare: "单核时间共享",
  printer: "虚拟打印队列",
  layers: "系统分层与请求路径",
  perspectives: "四个观察角度",
  goals: "操作系统五个目标",
  resources: "五类资源管理",
  roles: "管理员与服务员",
  concurrency: "单核/双核并发与并行",
  race: "共享变量竞争",
  async: "异步I/O事件",
  history: "系统模块与历史口径",
};
export interface SimConfig {
  template: Template;
  capacity?: number;
  allocation_a?: number;
  allocation_b?: number;
  allocation_c?: number;
  quantum?: number;
  tasks?: number;
  duration?: number;
  cores?: number;
  arrival_gap?: number;
  io_delay?: number;
  switch_cost?: number;
  initial?: number;
  locked?: boolean;
  interleaved?: boolean;
  scenario?: number;
}
export interface Frame {
  step: number;
  time: number;
  label: string;
  explanation: string;
  nodes: { name: string; state: string; value?: number }[];
}
export interface Trace {
  id: number;
  engine_version: number;
  frames: Frame[];
  config: SimConfig;
  disclaimer: string;
}
