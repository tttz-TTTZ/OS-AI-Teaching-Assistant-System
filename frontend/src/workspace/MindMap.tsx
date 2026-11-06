import { useMemo, useRef, useState } from "react";
import { LearningModule } from "../personal";
import { sessionContext } from "../api";

type Topic = LearningModule["nodes"][number];
type Box = Topic & {
  x: number;
  y: number;
  height: number;
  lines: string[];
  branch: number;
};
const WIDTH = 230,
  GAP = 72,
  ROW_GAP = 18,
  MARGIN = 32;
const COLORS = [
  "#277c76",
  "#5968aa",
  "#ac7134",
  "#886299",
  "#3a7c9a",
  "#66833e",
];

// Local layout only: model output remains data, never SVG/HTML or executable code.
function layout(nodes: Topic[]) {
  const children = new Map<string | null, Topic[]>();
  nodes.forEach((n) =>
    children.set(n.parent, [...(children.get(n.parent) || []), n]),
  );
  const lines = (label: string) => {
    const result: string[] = [];
    let line = "",
      units = 0;
    for (const c of Array.from(label)) {
      const size = /[\u0000-\u00ff]/.test(c) ? 1 : 2;
      if (c === "\n" || units + size > 26) {
        result.push(line);
        line = "";
        units = 0;
        if (c === "\n") continue;
      }
      line += c;
      units += size;
    }
    result.push(line);
    return result;
  };
  const heights = new Map<string, number>(),
    spans = new Map<string, number>();
  function measure(n: Topic): number {
    const height = Math.max(52, lines(n.label).length * 23 + 24);
    heights.set(n.id, height);
    const kids = children.get(n.id) || [];
    const span = Math.max(
      height,
      kids.reduce((sum, c) => sum + measure(c), 0) +
        Math.max(0, kids.length - 1) * ROW_GAP,
    );
    spans.set(n.id, span);
    return span;
  }
  const root = children.get(null)?.[0];
  if (!root) return { boxes: [] as Box[], width: 640, height: 160 };
  measure(root);
  const boxes: Box[] = [];
  const branches = children.get(root.id) || [];
  const right = branches.filter((_, i) => i % 2 === 0),
    left = branches.filter((_, i) => i % 2 === 1);
  const total = (ns: Topic[]) =>
    ns.reduce((sum, n) => sum + spans.get(n.id)!, 0) +
    Math.max(0, ns.length - 1) * ROW_GAP;
  const height = Math.max(heights.get(root.id)!, total(left), total(right));
  function place(
    n: Topic,
    depth: number,
    dir: number,
    top: number,
    branch: number,
  ) {
    const span = spans.get(n.id)!,
      h = heights.get(n.id)!;
    boxes.push({
      ...n,
      x: depth * (WIDTH + GAP) * dir,
      y: top + (span - h) / 2,
      height: h,
      lines: lines(n.label),
      branch,
    });
    const kids = children.get(n.id) || [];
    let next = top + (span - total(kids)) / 2;
    kids.forEach((c) => {
      place(c, depth + 1, dir, next, branch);
      next += spans.get(c.id)! + ROW_GAP;
    });
  }
  boxes.push({
    ...root,
    x: 0,
    y: (height - heights.get(root.id)!) / 2,
    height: heights.get(root.id)!,
    lines: lines(root.label),
    branch: -1,
  });
  [right, left].forEach((side, i) => {
    let next = (height - total(side)) / 2;
    side.forEach((n) => {
      place(n, 1, i === 0 ? 1 : -1, next, branches.indexOf(n));
      next += spans.get(n.id)! + ROW_GAP;
    });
  });
  const minX = Math.min(...boxes.map((b) => b.x)),
    maxX = Math.max(...boxes.map((b) => b.x));
  boxes.forEach((b) => {
    b.x += MARGIN - minX;
    b.y += MARGIN;
  });
  return {
    boxes,
    width: maxX - minX + WIDTH + MARGIN * 2,
    height: height + MARGIN * 2,
  };
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MindMap({
  module,
  job,
  index,
}: {
  module: LearningModule;
  job: number;
  index: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const graph = useMemo(() => layout(module.nodes), [module.nodes]);
  const [zoom, setZoom] = useState("fit"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const filename =
    module.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) ||
    "思维导图";
  const svgText = () => {
    const copy = svg.current!.cloneNode(true) as SVGSVGElement;
    copy.removeAttribute("style");
    return new XMLSerializer().serializeToString(copy);
  };
  async function png() {
    setBusy(true);
    setError("");
    let url = "";
    try {
      await document.fonts.ready;
      const copy = svg.current!.cloneNode(true) as SVGSVGElement;
      copy.setAttribute("width", String(graph.width));
      copy.setAttribute("height", String(graph.height));
      copy.removeAttribute("style");
      url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(copy)], {
          type: "image/svg+xml;charset=utf-8",
        }),
      );
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("导图转换失败，请尝试下载 SVG"));
        img.src = url;
      });
      const scale = Math.min(
        2,
        8192 / graph.width,
        8192 / graph.height,
        Math.sqrt(16000000 / (graph.width * graph.height)),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(graph.width * scale));
      canvas.height = Math.max(1, Math.round(graph.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("浏览器不支持图片导出，请下载 SVG");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b ? resolve(b) : reject(new Error("图片生成失败，请下载 SVG")),
          "image/png",
        ),
      );
      saveBlob(blob, filename + ".png");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (url) URL.revokeObjectURL(url);
      setBusy(false);
    }
  }
  return (
    <section className="mindmap" aria-label="个人思维导图">
      <div className="mindmap-toolbar">
        <label>
          显示比例{" "}
          <select value={zoom} onChange={(e) => setZoom(e.target.value)}>
            <option value="fit">适应宽度</option>
            <option value="0.75">75%</option>
            <option value="1">100%</option>
            <option value="1.5">150%</option>
          </select>
        </label>
        <button className="secondary" disabled={busy} onClick={png}>
          {busy ? "正在生成图片…" : "下载 PNG"}
        </button>
        <button
          className="secondary"
          onClick={() =>
            saveBlob(
              new Blob([svgText()], { type: "image/svg+xml;charset=utf-8" }),
              filename + ".svg",
            )
          }
        >
          下载 SVG
        </button>
        <a
          className="button secondary"
          href={`/api/student/personal/jobs/${job}/modules/${index}/mindmap.xmind?session_context=${encodeURIComponent(sessionContext())}`}
          download
        >
          下载 XMind
        </a>
      </div>
      <p className="mindmap-hint">
        中心主题 → 分支 → 子主题；可横向滚动、调整比例。PNG 适合分享，SVG
        可无损放大，XMind 可继续编辑。
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="mindmap-canvas" tabIndex={0} aria-label="思维导图画布">
        <svg
          ref={svg}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`${module.title}：思维导图`}
          viewBox={`0 0 ${graph.width} ${graph.height}`}
          width={graph.width}
          height={graph.height}
          style={
            zoom === "fit"
              ? { width: "100%", minWidth: 560, height: "auto" }
              : {
                  width: graph.width * Number(zoom),
                  height: graph.height * Number(zoom),
                  maxWidth: "none",
                }
          }
        >
          <title>{module.title}</title>
          <rect width={graph.width} height={graph.height} fill="#f7fafc" />
          {graph.boxes
            .filter((b) => b.parent)
            .map((b) => {
              const parent = graph.boxes.find((p) => p.id === b.parent)!;
              const right = b.x > parent.x,
                x1 = parent.x + (right ? WIDTH : 0),
                x2 = b.x + (right ? 0 : WIDTH),
                y1 = parent.y + parent.height / 2,
                y2 = b.y + b.height / 2,
                middle = (x1 + x2) / 2;
              return (
                <path
                  key={`edge-${b.id}`}
                  d={`M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={COLORS[b.branch % COLORS.length]}
                  strokeWidth="2.5"
                />
              );
            })}
          {graph.boxes.map((b) => (
            <g key={b.id}>
              <rect
                x={b.x}
                y={b.y}
                width={WIDTH}
                height={b.height}
                rx="12"
                fill={b.branch < 0 ? "#246963" : "#ffffff"}
                stroke={
                  b.branch < 0 ? "#246963" : COLORS[b.branch % COLORS.length]
                }
                strokeWidth="2"
              />
              <text
                x={b.x + WIDTH / 2}
                y={b.y + (b.height - b.lines.length * 23) / 2 + 17}
                textAnchor="middle"
                fontFamily="Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"
                fontSize="15"
                fontWeight={b.branch < 0 ? "700" : "500"}
                fill={b.branch < 0 ? "#ffffff" : "#203a48"}
              >
                {b.lines.map((line, i) => (
                  <tspan key={i} x={b.x + WIDTH / 2} dy={i ? 23 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}
