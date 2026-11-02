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
