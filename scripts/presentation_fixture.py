"""测试用合成课件；不含真实课程资料。无需Office或额外依赖。"""

from io import BytesIO
from zipfile import ZipFile, ZIP_STORED
import struct


def pptx_bytes(pages=400, media_bytes=0, reverse=False):
    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_STORED) as book:
        book.writestr(
            "[Content_Types].xml",
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>',
        )
        book.writestr(
            "ppt/presentation.xml",
            '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>'
            + "".join(
                f'<p:sldId id="{i+256}" r:id="r{i}"/>' for i in range(1, pages + 1)
            )
            + "</p:sldIdLst></p:presentation>",
        )
        book.writestr(
            "ppt/_rels/presentation.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(
                f'<Relationship Id="r{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{pages-i+1 if reverse else i}.xml"/>'
                for i in range(1, pages + 1)
            )
            + "</Relationships>",
        )
        for i in range(1, pages + 1):
            book.writestr(
                f"ppt/slides/slide{i}.xml",
                f'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><a:p><a:r><a:t>演示第{i}页</a:t></a:r></a:p></p:spTree></p:cSld></p:sld>',
            )
        if media_bytes:
            book.writestr("ppt/media/demo.bin", b"x" * media_bytes)
    return output.getvalue()


def ppt_bytes():
    # Minimal compound-file container with a PowerPoint document stream.
    free, end, fat = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD
    header = bytearray(512)
    header[:8] = bytes.fromhex("d0cf11e0a1b11ae1")
    struct.pack_into("<HHHHH", header, 24, 0x3E, 3, 0xFFFE, 9, 6)
    struct.pack_into("<IIIIIIIII", header, 40, 0, 1, 0, 0, 4096, end, 0, end, 0)
    struct.pack_into("<109I", header, 76, 1, *([free] * 108))
    directory = bytearray(512)

    def entry(offset, name, kind, start, size, child=free):
        encoded = (name + "\0").encode("utf-16le")
        directory[offset : offset + len(encoded)] = encoded
        struct.pack_into(
            "<HBBIII", directory, offset + 64, len(encoded), kind, 1, free, free, child
        )
        struct.pack_into("<IQ", directory, offset + 116, start, size)

    entry(0, "Root Entry", 5, end, 0, 1)
    entry(128, "PowerPoint Document", 2, 2, 4096)
    allocation = [end, fat, *range(3, 10), end] + [free] * 118
    return (
        bytes(header)
        + bytes(directory)
        + struct.pack("<128I", *allocation)
        + b"\x0f\0\xe8\x03"
        + b"\0" * 4092
    )


if __name__ == "__main__":
    import sys
    from pathlib import Path

    Path(sys.argv[1]).write_bytes(pptx_bytes())
