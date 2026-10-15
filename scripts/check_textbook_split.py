import hashlib
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, NumberObject

script = Path(__file__).resolve().with_name("split_textbook.py")
with TemporaryDirectory() as name:
    root = Path(name)
    source = root / "book.pdf"
    writer = PdfWriter()
    for i in range(450):
        page = writer.add_blank_page(width=200, height=300)
        page[NameObject("/OriginalOrdinal")] = NumberObject(i + 1)
    with source.open("wb") as out:
        writer.write(out)
    before = hashlib.sha256(source.read_bytes()).hexdigest()
    cmd = [
        sys.executable,
        str(script),
        str(source),
        "--body-start-page",
        "10",
        "--chapters",
        "2,7",
    ]
    dry = subprocess.run(cmd, capture_output=True, text=True)
    assert dry.returncode == 0, dry.stderr
    assert "PDF第64—131页" in dry.stdout and "PDF第366—410页" in dry.stdout
    output = root / "parts"
    run = subprocess.run(
        cmd + ["--output", str(output), "--max-mb", "0.002", "--write"],
        capture_output=True,
        text=True,
    )
    assert run.returncode == 0, run.stderr
    files = sorted(output.glob("*.pdf"))
    assert len(files) > 2
    for chapter, start, end in [(2, 64, 131), (7, 366, 410)]:
        got = []
        for file in sorted(output.glob(f"{chapter:02d}_*.pdf")):
            assert file.stat().st_size <= int(0.002 * 1024 * 1024)
            got.extend(int(page["/OriginalOrdinal"]) for page in PdfReader(file).pages)
        assert got == list(range(start, end + 1)), got
    assert hashlib.sha256(source.read_bytes()).hexdigest() == before
    assert (
        subprocess.run(
            cmd + ["--output", str(output), "--write"], capture_output=True
        ).returncode
        != 0
    )
    fail = root / "too_small"
    assert (
        subprocess.run(
            cmd + ["--output", str(fail), "--max-mb", "0.000001", "--write"],
            capture_output=True,
        ).returncode
        != 0
    )
    assert not fail.exists()
    assert (
        subprocess.run(
            [sys.executable, str(script), str(source), "--body-start-page", "10000"],
            capture_output=True,
        ).returncode
        != 0
    )
    print(
        f"PASS: 合成450页PDF；两章页序映射、大小二分({len(files)}份)、无漏页/重复页、原件哈希不变、拒绝覆盖、单页过大失败无半成品、越界拒绝"
    )
