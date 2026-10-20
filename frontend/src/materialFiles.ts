export const materialAccept = ".pdf,.txt,.ppt,.pptx";
export const publicFileHint =
  "公共课件 PPT/PPTX ≤500 MiB，PDF ≤150 MiB，UTF-8 TXT ≤10 MiB";
export const personalFileHint = "个人课件 PPT/PPTX ≤50 MiB，PDF/TXT ≤10 MiB";
export function materialFileError(file: File, publicFile = false) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["pdf", "txt", "ppt", "pptx"].includes(ext))
    return "请选择 PDF、UTF-8 TXT、PPT 或 PPTX 文件";
  const mib =
    ext === "ppt" || ext === "pptx"
      ? publicFile
        ? 500
        : 50
      : ext === "pdf" && publicFile
        ? 150
        : 10;
  return !file.size
    ? "文件不能为空"
    : file.size > mib * 1024 * 1024
      ? `该类型文件最大 ${mib} MiB，当前 ${(file.size / 1024 / 1024).toFixed(1)} MiB`
      : "";
}
