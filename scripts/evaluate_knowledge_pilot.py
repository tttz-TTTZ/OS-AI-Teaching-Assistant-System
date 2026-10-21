"""Reproducible synthetic multi-PPT comparison. No live AI, no changes to application data."""

import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from pilot_fixture import GOLD, decks, model_output


def run():
    with tempfile.TemporaryDirectory(prefix="os-pilot-eval-") as folder:
        os.environ["DATABASE_PATH"] = str(Path(folder) / "test.db")
        os.environ["DEEPSEEK_API_KEY"] = "test-only-no-network"
        from fastapi.testclient import TestClient
        from app import main, personal_learning as ai
        from app.auth import create_user

        calls = []

        async def fake(body, source, **kw):
            calls.append(kw["payload"]["task"])
            return model_output(kw["payload"])

        ai.call_deepseek = fake
        base = "/api/student/personal"
        with TestClient(main.app) as teacher, TestClient(main.app) as student:
            for client, name, role in [
                (teacher, "teacher-eval", "teacher"),
                (student, "student-eval", "student"),
            ]:
                password = secrets.token_urlsafe(24)
                create_user(name, password, role)
                login = client.post(
                    "/api/auth/login", json={"username": name, "password": password}
                )
                client.headers["X-CSRF-Token"] = login.json()["csrf_token"]
            section = teacher.post(
                "/api/teacher/sections",
                json={
                    "chapter_id": 1,
                    "title": "基本服务和用户接口（合成验收样例）",
                    "published": True,
                },
            ).json()["id"]
            documents = [
                student.post(
                    "/api/materials/upload", files={"file": (f"合成课件{i}.pptx", data)}
                ).json()["id"]
                for i, data in enumerate(decks())
            ]
            config = {
                "chapter_id": 1,
                "section_id": section,
                "topic": "基本服务和用户接口",
                "sources": [{"document_id": d} for d in documents],
                "modes": ["map"],
                "source_overview": True,
                "analysis_mode": "section",
                "analysis_confirmed": True,
                "request_key": "evaluation-map-000001",
            }
            old = student.post(
                base + "/sources/preview", json={**config, "analysis_mode": "quick"}
            ).json()
            plan = student.post(base + "/sources/preview", json=config)
            plan.raise_for_status()
            config["fingerprint"] = plan.json()["fingerprint"]
            generated = student.post(base + "/generate", json=config)
            generated.raise_for_status()
            state = generated.json()["body"]["pilot"]
            config.update(modes=["flashcards"], request_key="evaluation-cards-00001")
            cards = student.post(base + "/generate", json=config)
            cards.raise_for_status()
            deck = cards.json()["body"]["modules"][0]["cards"]
            expected = {s for _, s in GOLD}
            old_text = "\n".join(c["text"] for c in old["chunks"])
            old_coverage = sum(s in old_text for s in expected) / len(expected)
            actual = {f["statement"] for f in state["facts"]}
            raw_count = sum(
                len(b["facts"])
                for batch in state["batches"].values()
                for b in batch["blocks"]
            )
            return {
                "dataset": "2 authored synthetic PPTX; each has 6 directory slides then 4 body slides; 6 distinct gold facts, 2 duplicates",
                "live_model": False,
                "model": "deterministic boundary fixture; tests engineering coverage, not real DeepSeek quality",
                "baseline": {
                    "read_chunks": len(old["chunks"]),
                    "gold_facts_present_in_input": old_coverage,
                    "flashcard_quality": "not measured; no baseline flashcards generated",
                },
                "pilot": {
                    "selected_pages": state["plan"]["selected_pages"],
                    "excluded_directory_blocks": len(state["plan"]["excluded"]),
                    "processed_body_blocks": state["metrics"]["processed_chunks"],
                    "expected_body_blocks": state["metrics"]["selected_chunks"],
                    "gold_facts_in_result": len(expected & actual) / len(expected),
                    "raw_facts": raw_count,
                    "deduplicated_facts": len(actual),
                    "duplicates_removed": raw_count - len(actual),
                    "map_fact_reference_coverage": state["metrics"][
                        "artifact_fact_coverage"
                    ],
                    "map_calls": state["calls_used"],
                    "flashcard_additional_calls": cards.json()["body"]["pilot"][
                        "calls_used"
                    ],
                    "cards": len(deck),
                    "duplicate_card_questions": len(deck)
                    - len({c["front"] for c in deck}),
                    "answers_match_gold_facts": sum(c["back"] in expected for c in deck)
                    / len(deck),
                },
                "unverified": [
                    "real PPT semantics and layout",
                    "real DeepSeek extraction and question quality",
                    "performance and cost on 400-slide documents",
                ],
            }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = json.dumps(run(), ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(result + "\n", encoding="utf-8")
    print(result)
