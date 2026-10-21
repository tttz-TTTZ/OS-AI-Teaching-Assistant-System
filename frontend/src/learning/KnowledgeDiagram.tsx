import { useId } from "react";
import { Diagram } from "../digital";

// Only structured text and coordinates are rendered; no raw SVG/HTML from a model.
export default function KnowledgeDiagram({ diagram: d }: { diagram: Diagram }) {
  const marker = "arrow" + useId().replace(/:/g, "");
  const nodeRight = Math.max(...d.nodes.map((n) => n.x + 260));
  const width = nodeRight + (d.type === "flow" ? 100 : 30);
  const height = Math.max(...d.nodes.map((n) => n.y + 76)) + 45;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  return (
    <figure className="knowledge-diagram">
      <div className="diagram-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ minWidth: Math.min(width, 880) }}
          role="img"
          aria-label={`${d.code} ${d.title}`}
        >
          <title>{d.title}</title>
          <defs>
            <marker
              id={marker}
              markerWidth="9"
              markerHeight="9"
              refX="8"
              refY="4"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="#276d68" />
            </marker>
          </defs>
          {d.edges.map((e, i) => {
            const a = byId.get(e.source),
              b = byId.get(e.target);
            if (!a || !b) return null;
            const horizontal = Math.abs(b.x - a.x) > Math.abs(b.y - a.y);
            const ax = a.x + 130 + (horizontal ? (b.x > a.x ? 130 : -130) : 0),
              ay = a.y + 38 + (!horizontal ? (b.y > a.y ? 38 : -38) : 0);
            const bx = b.x + 130 + (horizontal ? (b.x > a.x ? -130 : 130) : 0),
              by = b.y + 38 + (!horizontal ? (b.y > a.y ? -38 : 38) : 0);
            const bend = 35 + (i % 3) * 22;
            let path = horizontal
              ? `M${ax},${ay} C${ax + (b.x > a.x ? bend : -bend)},${ay} ${bx - (b.x > a.x ? bend : -bend)},${by} ${bx},${by}`
              : `M${ax},${ay} C${ax + bend},${ay} ${bx + bend},${by} ${bx},${by}`;
            let labelX = (ax + bx) / 2 + (horizontal ? 0 : bend / 2);
            let labelY = (ay + by) / 2 - 8;
            let labelAnchor: "middle" | "start" | "end" = "middle";
            if (d.type === "flow" && b.y < a.y) {
              const left = a.x < 350;
              const lane = left
                ? 8 + (i % 2) * 9
                : nodeRight + 35 + (i % 3) * 18;
              const startX = left ? a.x : a.x + 260;
              path = `M${startX},${a.y + 38} H${lane} V${b.y - 25} H${b.x + 130} V${b.y}`;
              labelX = lane + (left ? 10 : -10);
              labelY = (a.y + b.y) / 2;
              labelAnchor = left ? "start" : "end";
            } else if (d.type === "flow" && a.x === b.x) {
              path = `M${a.x + 130},${a.y + 76} V${b.y}`;
              labelX = a.x + 185;
            } else if (d.type === "flow" && a.y === b.y) {
              labelY = a.y - 10;
            }
            return (
              <g key={i}>
                <path
                  d={path}
                  fill="none"
                  stroke="#276d68"
                  strokeWidth="2"
                  strokeDasharray={
                    e.direction === "unconfirmed" ? "6 5" : undefined
                  }
                  markerEnd={
                    e.direction === "directed" ? `url(#${marker})` : undefined
                  }
                >
                  <title>
                    {a.label} — {e.label} — {b.label}
                  </title>
                </path>
                <text
                  x={labelX}
                  y={labelY}
                  textAnchor={labelAnchor}
                  fontSize="12"
                  fill="#234e57"
                  stroke="white"
                  strokeWidth="4"
                  paintOrder="stroke"
                >
                  {e.label.length > 16 ? e.label.slice(0, 15) + "…" : e.label}
                </text>
              </g>
            );
          })}
          {d.nodes.map((n) => {
            const lines = n.label.match(/.{1,14}/gu) || [""];
            return (
              <g key={n.id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width="260"
                  height="76"
                  rx={d.type === "flow" ? 22 : 9}
                  fill="white"
                  stroke="#276d68"
                  strokeWidth="2"
                />
                <text
                  x={n.x + 130}
                  y={n.y + 38 - (lines.length - 1) * 10}
                  textAnchor="middle"
                  fill="#183d46"
                  fontSize="16"
                >
                  {lines.map((s, i) => (
                    <tspan x={n.x + 130} dy={i ? 21 : 0} key={i}>
                      {s}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>
        {d.code} · {d.type === "flow" ? "静态流程图" : "概念关系图"} ·
        虚线无箭头表示方向待核实
      </figcaption>
      <div className="tablewrap">
        <table>
          <caption>关系与分支说明（与图同步）</caption>
          <thead>
            <tr>
              <th>起点</th>
              <th>关系 / 条件</th>
              <th>终点</th>
              <th>方向</th>
            </tr>
          </thead>
          <tbody>
            {d.edges.map((e, i) => (
              <tr key={i}>
                <td>{byId.get(e.source)?.label}</td>
                <td>{e.label}</td>
                <td>{byId.get(e.target)?.label}</td>
                <td>
                  {e.direction === "unconfirmed"
                    ? "待核实"
                    : e.direction === "directed"
                      ? "有向"
                      : "无向"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
