import {
  Content,
  ContentBlock,
  blockKinds,
  templates,
  Template,
  digitalApi,
} from "../digital";
import { ConfigFields } from "./Interaction";
export default function BlockEditor({
  form,
  change,
  setBusy,
  setError,
}: {
  form: Content;
  change: (content: Content) => void;
  setBusy: (busy: boolean) => void;
  setError: (error: string) => void;
}) {
  function changeBlock(index: number, patch: Partial<ContentBlock>) {
    change({
      ...form,
      blocks: form.blocks.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    });
  }
  function move(index: number, delta: number) {
    const blocks = [...form.blocks];
    [blocks[index], blocks[index + delta]] = [
      blocks[index + delta],
      blocks[index],
    ];
    change({ ...form, blocks });
  }
  return (
    <>
      <div className="blocks-editor">
        {form.blocks.map((block, index) => (
          <section className="block-editor" key={block.id}>
            <div className="toolbar">
              <strong>
                {index + 1}. {blockKinds[block.kind]}
              </strong>
              <button
                type="button"
                className="secondary"
                disabled={!index}
                onClick={() => move(index, -1)}
              >
                上移
              </button>
              <button
                type="button"
                className="secondary"
                disabled={index === form.blocks.length - 1}
                onClick={() => move(index, 1)}
              >
                下移
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  change({
                    ...form,
                    blocks: [
                      ...form.blocks,
                      {
                        ...structuredClone(block),
                        id: crypto.randomUUID(),
                      },
                    ],
                  })
                }
              >
                复制块
              </button>
              <button
                type="button"
                className="danger"
                onClick={() =>
                  change({
                    ...form,
                    blocks: form.blocks.filter((_, i) => i !== index),
                  })
                }
              >
                删除块
              </button>
            </div>
            <label>
              内容块标题
              <input
                maxLength={200}
                value={block.title}
                onChange={(e) => changeBlock(index, { title: e.target.value })}
              />
            </label>
            <label>
              {blockKinds[block.kind]}正文
              <textarea
                aria-label={
                  block.kind === "explanation"
                    ? "正文（支持基础 Markdown）"
                    : blockKinds[block.kind] + "正文"
                }
                maxLength={50000}
                className="editor"
                value={block.text}
                onChange={(e) => changeBlock(index, { text: e.target.value })}
              />
            </label>
            {block.kind === "interaction" && (
              <>
                <label>
                  教学互动模板
                  <select
                    aria-label="教学互动模板"
                    value={block.config?.template || "memory"}
                    onChange={(e) =>
                      changeBlock(index, {
                        config: {
                          template: e.target.value as Template,
                        },
                      })
                    }
                  >
                    {Object.entries(templates).map(([key, title]) => (
                      <option key={key} value={key}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <ConfigFields
                  value={block.config || { template: "memory" }}
                  onChange={(config) => changeBlock(index, { config })}
                />
              </>
            )}
            {block.kind === "image" && (
              <>
                <label>
                  教学图片文件
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setBusy(true);
                      try {
                        const result = await digitalApi.upload(file);
                        changeBlock(index, { asset_id: result.id });
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </label>
                <small>
                  {block.asset_id
                    ? "图片已上传 #" + block.asset_id
                    : "PNG/JPEG/WebP ≤10MiB"}
                </small>
                <label>
                  图片说明/替代文字
                  <input
                    maxLength={500}
                    value={block.alt || ""}
                    onChange={(e) =>
                      changeBlock(index, { alt: e.target.value })
                    }
                  />
                </label>
              </>
            )}
            {block.kind === "chart" && (
              <>
                <label>
                  数据标签（每行一个）
                  <textarea
                    aria-label="数据标签（每行一个）"
                    value={block.labels?.join("\n") || ""}
                    onChange={(e) =>
                      changeBlock(index, {
                        labels: e.target.value.split("\n"),
                      })
                    }
                  />
                </label>
                <label>
                  数值（每行一个，与标签对应）
                  <textarea
                    aria-label="数值（每行一个，与标签对应）"
                    value={block.values?.join("\n") || ""}
                    onChange={(e) =>
                      changeBlock(index, {
                        values: e.target.value.split("\n").map(Number),
                      })
                    }
                  />
                </label>
                <label>
                  单位
                  <input
                    maxLength={40}
                    value={block.unit || ""}
                    onChange={(e) =>
                      changeBlock(index, { unit: e.target.value })
                    }
                  />
                </label>
                <small>
                  只录入已核实的数据，并在正文写明统计版本、口径和来源。
                </small>
              </>
            )}
          </section>
        ))}
      </div>
      <div className="toolbar">
        <label>
          添加内容模块
          <select
            aria-label="添加内容模块"
            value=""
            onChange={(e) => {
              const kind = e.target.value as ContentBlock["kind"];
              if (kind)
                change({
                  ...form,
                  blocks: [
                    ...form.blocks,
                    {
                      id: crypto.randomUUID(),
                      kind,
                      title: blockKinds[kind],
                      text: "",
                      ...(kind === "interaction"
                        ? { config: { template: "memory" as Template } }
                        : {}),
                    },
                  ],
                });
            }}
          >
            <option value="">选择模块</option>
            {Object.entries(blockKinds).map(([kind, title]) => (
              <option key={kind} value={kind}>
                {title}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}
