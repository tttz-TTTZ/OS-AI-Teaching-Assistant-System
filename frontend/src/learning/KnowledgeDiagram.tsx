import { useId, useState } from "react";
import { Diagram } from "../digital";

// Only structured text and coordinates are rendered; no raw SVG/HTML from a model.
export default function KnowledgeDiagram({
  diagram: d,
  editor = false,
}: {
  diagram: Diagram;
  editor?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [edgeIndex, setEdgeIndex] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const marker = "arrow" + useId().replace(/:/g, "");
  const nodeRight = Math.max(...d.nodes.map((n) => n.x + 260));
  const width = nodeRight + (d.type === "flow" ? 100 : 30);
  const height = Math.max(...d.nodes.map((n) => n.y + 76)) + 45;
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const selectedEdge = edgeIndex === null ? undefined : d.edges[edgeIndex];
  const related = selectedEdge
    ? [selectedEdge]
    : selected
      ? d.edges.filter((e) => e.source === selected || e.target === selected)
      : [];
  const highlights = new Set(
    selectedEdge
      ? [selectedEdge.source, selectedEdge.target]
      : selected
        ? [selected, ...related.flatMap((e) => [e.source, e.target])]
        : [],
  );
  function chooseNode(id: string) {
    setSelected(selected === id ? null : id);
    setEdgeIndex(null);
  }
  return (
    <figure className="knowledge-diagram">
      <div className="diagram-controls" aria-label="图示操作">
        <span>{d.type === "flow" ? "流程导读" : "概念关系"}</span>
        <button
          type="button"
          className="secondary"
          disabled={zoom <= 0.65}
          onClick={() => setZoom((z) => Math.max(0.65, z - 0.2))}
        >
          缩小
        </button>
        <button
          type="button"
          className="secondary"
          disabled={zoom >= 1.8}
          onClick={() => setZoom((z) => Math.min(1.8, z + 0.2))}
        >
          放大
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setZoom(1);
            setSelected(null);
            setEdgeIndex(null);
          }}
        >
          重置图示
        </button>
        {d.type === "flow" && (
          <>
            <button
              type="button"
              className="secondary"
              disabled={edgeIndex === 0 || !d.edges.length}
              onClick={() => {
                setEdgeIndex((i) => Math.max(0, (i ?? 1) - 1));
                setSelected(null);
              }}
            >
              上一条关系
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!d.edges.length || edgeIndex === d.edges.length - 1}
              onClick={() => {
                setEdgeIndex((i) =>
                  Math.min(d.edges.length - 1, (i ?? -1) + 1),
                );
                setSelected(null);
              }}
            >
              下一条关系
            </button>
          </>
        )}
      </div>
      <div className="diagram-reading-note" aria-live="polite">
        {related.length ? (
          <>
            <strong>
              {selectedEdge
                ? `关系 ${edgeIndex! + 1} / ${d.edges.length}`
                : byId.get(selected!)?.label}
            </strong>
            <ul>
              {related.map((e, i) => (
                <li key={i}>
                  {byId.get(e.source)?.label} · <b>{e.label}</b> ·{" "}
                  {byId.get(e.target)?.label}
                  {e.direction === "unconfirmed" ? "（方向尚未明确）" : ""}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            点击图中的节点查看关联。
            {d.type === "flow"
              ? "也可以逐条看分支；这是读图引导，运行算法请进入配套实验。"
              : "先看概念，再看连线表达的关系。"}
          </p>
        )}
      </div>
      <div className="diagram-scroll">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            minWidth: zoom === 1 ? Math.min(width, 760) : width * zoom,
            width: zoom === 1 ? "100%" : width * zoom,
          }}
          role="group"
          aria-roledescription="可交互图示"
          aria-label={editor ? `${d.code} ${d.title}` : d.title}
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
              <g
                key={i}
                opacity={
                  selectedEdge
                    ? e === selectedEdge
                      ? 1
                      : 0.18
                    : selected && !related.includes(e)
                      ? 0.18
                      : 1
                }
              >
                <path
                  d={path}
                  fill="none"
                  stroke={e === selectedEdge ? "#b65d1d" : "#276d68"}
                  strokeWidth={e === selectedEdge ? 4 : 2}
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
              <g
                key={n.id}
                className="diagram-node"
                role="button"
                tabIndex={0}
                aria-label={`查看${n.label}的关系`}
                aria-pressed={selected === n.id}
                onClick={() => chooseNode(n.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    chooseNode(n.id);
                  }
                }}
                opacity={highlights.size && !highlights.has(n.id) ? 0.35 : 1}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width="260"
                  height="76"
                  rx={d.type === "flow" ? 22 : 9}
                  fill={highlights.has(n.id) ? "#def1eb" : "white"}
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
        {editor && `${d.code} · `}
        {d.type === "flow" ? "流程图" : "概念关系图"}
        {d.edges.some((e) => e.direction === "unconfirmed") &&
          " · 无箭头虚线表示关系方向尚未明确"}
      </figcaption>
      <details className="diagram-relations" open={editor}>
        <summary>查看全部关系与分支</summary>
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
      </details>
    </figure>
  );
}
