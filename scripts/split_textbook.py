"""免费、本地按教材章节拆 PDF；预览默认不写文件，--write 才导出。
可选依赖：python -m pip install pypdf==5.9.0
原文件保持只读；实际书籍需由用户核对 PDF 页序及输出内容。
"""

import argparse
from pathlib import Path
import shutil
import tempfile

# 根据用户提供的《操作系统教程》第5版目录：范围含本章习题。
CHAPTERS = [
    (1, "操作系统概论", 1, 54),
    (2, "处理器管理", 55, 122),
    (3, "同步_通信与死锁", 123, 192),
    (4, "存储管理", 193, 254),
    (5, "设备管理", 255, 296),
    (6, "文件管理", 297, 356),
    (7, "操作系统安全与保护", 357, 401),
]


def plan(body_start: int, total: int, selected: set[int]):
    """body_start 为正文印刷第1页在PDF中的1-based实际页序。"""
    result = []
    for number, title, start, end in CHAPTERS:
        if number not in selected:
            continue
        first = body_start + start - 2  # pypdf 0-based
        stop = body_start + end - 1  # exclusive
        if first < 0 or stop > total:
            raise ValueError(
                f"第{number}章映射超出PDF页数，请检查正文起始页；需要PDF第{stop}页，总共{total}页"
            )
        result.append((number, title, start, end, first, stop))
    return result


def split_range(
    reader, first: int, stop: int, max_bytes: int, folder: Path, jobs: list
):
    from pypdf import PdfWriter

    writer = PdfWriter()
    for index in range(first, stop):
        writer.add_page(reader.pages[index])
    temp = folder / f"pages_{first}_{stop}.pdf"
    try:
        with temp.open("xb") as target:
            writer.write(target)
    finally:
        writer.close()
    if temp.stat().st_size <= max_bytes:
        jobs.append((first, stop, temp))
        return
    temp.unlink()
    if stop - first == 1:
        raise ValueError(
            f"PDF第{first+1}页单页导出仍超过大小限制；请用本地PDF压缩/降低图像分辨率，或另行调整系统上传方案"
        )
    middle = (first + stop) // 2
    split_range(reader, first, middle, max_bytes, folder, jobs)
    split_range(reader, middle, stop, max_bytes, folder, jobs)


def main():
    parser = argparse.ArgumentParser(
        description="按校内教材第1—7章拆分，默认仅预览，不需要PDF会员"
    )
    parser.add_argument("pdf", type=Path)
    parser.add_argument(
        "--body-start-page",
        required=True,
        type=int,
        help="印刷第1页对应的PDF实际页序，从1开始",
    )
    parser.add_argument("--chapters", default="1,2,3,4,5,6,7", help="例如2,3；默认1—7")
    parser.add_argument("--output", type=Path, help="导出目录，建议放在Git仓库之外")
    parser.add_argument(
        "--max-mb", type=float, default=9, help="每份最大MiB，默认9，留出10MB上传余量"
    )
    parser.add_argument("--write", action="store_true", help="确认预览后写入新导出目录")
    args = parser.parse_args()
    try:
        from pypdf import PdfReader
        from pypdf.errors import PyPdfError
    except ImportError:
        parser.error("请先运行当前Python的 -m pip install pypdf==5.9.0")
    if args.body_start_page < 1 or not 0 < args.max_mb <= 9:
        parser.error("正文页序必须≥1；导出大小须大于0且≤9MiB")
    try:
        selected = {int(value.strip()) for value in args.chapters.split(",")}
        if not selected or not selected <= set(range(1, 8)):
            raise ValueError("章节仅支持1—7")
        if not args.pdf.is_file():
            raise ValueError("输入PDF不存在")
        if args.write and (args.output is None or args.output.exists()):
            raise ValueError("导出须指定一个尚不存在的新目录，避免覆盖已有文件")
        with args.pdf.open("rb") as source:
            reader = PdfReader(source)
            if reader.is_encrypted:
                raise ValueError(
                    "文件已加密，请使用你有权访问且未加密的PDF；本工具不解密"
                )
            rows = plan(args.body_start_page, len(reader.pages), selected)
            print(
                f"PDF共{len(reader.pages)}页；请核对映射，纸质页码与PDF页序不一定相同："
            )
            for number, title, start, end, first, stop in rows:
                print(
                    f"第{number}章 {title}：印刷{start}—{end}页 → PDF第{first+1}—{stop}页"
                )
            if not args.write:
                print(
                    "仅预览，未导出。核对后加 --output 新目录 --write；原PDF不会修改。"
                )
                return
            max_bytes = int(args.max_mb * 1024 * 1024)
            # 先完成所有分段再创建目标目录；失败不留下半套教材。
            with tempfile.TemporaryDirectory(prefix="os-book-") as temp_name:
                temp = Path(temp_name)
                exports = []
                for number, title, start, end, first, stop in rows:
                    jobs = []
                    split_range(reader, first, stop, max_bytes, temp, jobs)
                    for index, (part_first, part_stop, path) in enumerate(jobs, 1):
                        printed_first = part_first - args.body_start_page + 2
                        printed_last = part_stop - args.body_start_page + 1
                        name = f"{number:02d}_{title}_part{index:02d}_p{printed_first}-{printed_last}.pdf"
                        exports.append((path, name))
                args.output.mkdir(parents=True, exist_ok=False)
                try:
                    for path, name in exports:
                        with path.open("rb") as source_file, (args.output / name).open(
                            "xb"
                        ) as out:
                            shutil.copyfileobj(source_file, out)
                    for path, name in exports:
                        print(f"{name} ({path.stat().st_size/1024/1024:.2f} MiB)")
                except BaseException:
                    shutil.rmtree(args.output)
                    raise
                print(
                    f"完成：{len(exports)}份文件，保存在 {args.output}；请抽查首尾页，再从教师端上传为草稿。"
                )
    except (ValueError, OSError, PyPdfError) as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
