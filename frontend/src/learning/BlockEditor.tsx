import {
  Content,
  ContentBlock,
  blockKinds,
  templates,
  Template,
  digitalApi,
  assetUrl,
} from "../digital";
import { ConfigFields } from "./Interaction";
export default function BlockEditor({
  form,
  change,
  setBusy,
  setError,
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
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
  function duplicate(index: number) {
    const copy = {
      ...structuredClone(form.blocks[index]),
      id: crypto.randomUUID(),
    };
    change({ ...form, blocks: [...form.blocks, copy] });
    onSelect(copy.id);
  }
  function remove(index: number) {
    const block = form.blocks[index];
    if (
      (block.text.trim() || block.asset_id || block.values?.length) &&
      !confirm("删除这个模块及其中内容？已保存的历史版本仍保留。")
    )
      return;
    const blocks = form.blocks.filter((_, i) => i !== index);
    change({ ...form, blocks });
    onSelect(blocks[Math.min(index, blocks.length - 1)]?.id || "objectives");
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
        {form.blocks.map((block, index) =>
          block.id === activeId ? (
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
                  onClick={() => duplicate(index)}
                >
                  复制块
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => remove(index)}
                >
                  删除块
                </button>
              </div>
              <label>
                内容块标题
                <input
                  maxLength={200}
                  value={block.title}
                  onChange={(e) =>
                    changeBlock(index, { title: e.target.value })
                  }
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
                    {block.asset_id ? "图片已上传" : "PNG/JPEG/WebP ≤10MiB"}
                  </small>
                  {block.asset_id && (
                    <img
                      className="uploaded-image-preview"
                      src={assetUrl(block.asset_id)}
                      alt={block.alt || "已上传的教学图片"}
                    />
                  )}
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
          ) : null,
        )}
      </div>
      <section className="authoring-card add-module">
        <h2>还想补充什么内容？</h2>
        <p>选择一种模块，马上进入它的独立编辑区域。</p>
        <div className="module-palette">
          {Object.entries(blockKinds).map(([kind, label]) => (
            <button
              type="button"
              className="secondary"
              key={kind}
              disabled={form.blocks.length >= 60}
              onClick={() => {
                const id = crypto.randomUUID();
                change({
                  ...form,
                  blocks: [
                    ...form.blocks,
                    {
                      id,
                      kind: kind as ContentBlock["kind"],
                      title: label,
                      text: "",
                      ...(kind === "interaction"
                        ? { config: { template: "memory" as Template } }
                        : {}),
                    },
                  ],
                });
                onSelect(id);
                window.scrollTo(0, 0);
              }}
            >
              ＋ {label}
            </button>
          ))}
        </div>
      </section>
    </>
  );
}
