"""人工编写的示例教材数据；独立维护，便于按实际教材修改。"""

import json
import sqlite3

CHAPTERS = [
    (
        "操作系统概述",
        "操作系统管理硬件资源，为应用程序提供运行环境。",
        "操作系统的目标",
        "便利性、有效性、可扩展性与开放性是理解操作系统设计的常见角度。",
        "操作系统的主要职责是？",
        ["管理系统资源", "只编辑文本", "只编译程序"],
        0,
    ),
    (
        "进程与线程",
        "理解进程状态、线程与上下文切换。",
        "进程与线程",
        "进程通常是资源分配的基本单位，线程是处理机调度的基本单位。同一进程中的线程共享地址空间。",
        "同一进程的线程通常共享什么？",
        ["独立的全部地址空间", "进程地址空间", "完全不共享资源"],
        1,
    ),
    (
        "处理机调度",
        "比较调度策略及等待时间、周转时间等指标。",
        "先来先服务 FCFS",
        "FCFS 按到达顺序非抢占地执行进程。周转时间=完成时间−到达时间，等待时间=开始时间−到达时间。无就绪进程时 CPU 空闲。",
        "周转时间如何计算？",
        ["运行时间−到达时间", "开始时间−运行时间", "完成时间−到达时间"],
        2,
    ),
    (
        "进程同步与死锁",
        "理解互斥、同步与死锁的必要条件。",
        "死锁的必要条件",
        "互斥、请求并保持、不可剥夺、循环等待是死锁的四个必要条件。破坏任一条件可防止死锁。",
        "下列哪项是死锁必要条件？",
        ["循环等待", "无限内存", "只有一个进程"],
        0,
    ),
    (
        "内存管理",
        "理解分页、虚拟内存与地址转换。",
        "分页管理",
        "分页把逻辑地址空间划分为固定大小的页，物理内存划分为同样大小的页框，通过页表建立映射。",
        "页表主要保存什么？",
        ["文件内容", "页到页框的映射", "进程源代码"],
        1,
    ),
    (
        "文件管理",
        "理解文件组织、目录与存储分配。",
        "文件与目录",
        "文件是具有名称的相关信息集合；目录维护文件名到文件元数据的映射，支持组织与查找。",
        "目录的主要作用是？",
        ["提高 CPU 主频", "执行进程调度", "组织和查找文件"],
        2,
    ),
    (
        "I/O 管理",
        "理解中断、缓冲与设备管理。",
        "中断驱动 I/O",
        "设备完成操作后发出中断通知 CPU，减少处理机持续轮询等待。缓冲可协调设备与处理机速度差异。",
        "中断驱动 I/O 的作用是？",
        ["减少持续轮询等待", "消除所有硬件错误", "替代全部内存"],
        0,
    ),
]


def initialize(db: sqlite3.Connection) -> None:
    db.executescript(
        """
    CREATE TABLE IF NOT EXISTS chapters(id INTEGER PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS knowledge(id INTEGER PRIMARY KEY, chapter_id INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, lab_path TEXT);
    CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, chapter_id INTEGER NOT NULL, prompt TEXT NOT NULL, options TEXT NOT NULL, answer INTEGER NOT NULL, explanation TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY);
    """
    )
    # 一次性种子迁移：后续人工修改与删除不会在重启时被覆盖。
    if not db.execute("SELECT 1 FROM schema_versions WHERE version=1").fetchone():
        for i, row in enumerate(CHAPTERS, 1):
            title, desc, topic, content, prompt, options, answer = row
            db.execute(
                "INSERT OR IGNORE INTO chapters VALUES (?,?,?)", (i, title, desc)
            )
            db.execute(
                "INSERT OR IGNORE INTO knowledge VALUES (?,?,?,?,?)",
                (i, i, topic, content, "/lab" if i == 3 else None),
            )
            db.execute(
                "INSERT OR IGNORE INTO questions VALUES (?,?,?,?,?,?)",
                (
                    i,
                    i,
                    prompt,
                    json.dumps(options, ensure_ascii=False),
                    answer,
                    content,
                ),
            )
        db.execute(
            "INSERT INTO materials(title,content,chapter,category) VALUES (?,?,?,?)",
            (
                "课程学习指南（示例）",
                "先学习章节知识点，再运行 FCFS 实验，最后完成章节练习。示例内容需按实际教材校对。",
                "操作系统概述",
                "public",
            ),
        )
        db.execute("INSERT INTO schema_versions VALUES (1)")
