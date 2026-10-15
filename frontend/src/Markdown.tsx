import { createElement, ReactNode } from "react";
// 只渲染受控标签；不执行 HTML，不使用 dangerouslySetInnerHTML。
function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .map((s, i) =>
      s.startsWith("`") ? (
        <code key={i}>{s.slice(1, -1)}</code>
      ) : s.startsWith("**") ? (
        <strong key={i}>{s.slice(2, -2)}</strong>
      ) : (
        s
      ),
    );
}
export default function Markdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const cells = (s: string) =>
    s
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((c) => c.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```"))
        code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={i}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)/.exec(line);
    if (heading) {
      blocks.push(
        createElement(
          `h${Math.min(heading[1].length + 1, 6)}`,
          { key: i },
          inline(heading[2]),
        ),
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s/.test(line) || /^\s*\d+\.\s/.test(line)) {
      const ordered = /^\s*\d+\.\s/.test(line);
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i++].replace(pattern, ""))}</li>);
      }
      blocks.push(createElement(ordered ? "ol" : "ul", { key: i }, items));
      continue;
    }
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])
    ) {
      const headers = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|"))
        rows.push(cells(lines[i++]));
      blocks.push(
        <div className="tablewrap" key={i}>
          <table>
            <thead>
              <tr>
                {headers.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, j) => (
                <tr key={j}>
                  {row.map((c, k) => (
                    <td key={k}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    blocks.push(<p key={i}>{inline(line)}</p>);
    i++;
  }
  return <div className="prose">{blocks}</div>;
}
