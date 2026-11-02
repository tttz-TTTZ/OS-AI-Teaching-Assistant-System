import { SimConfig, templates } from "../simulation";

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
