import { ReactNode, useEffect, useState } from "react";
import { Chapter, courseApi } from "./api";
export function Page({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <header>
        <span>OPERATING SYSTEMS / LEARNING SPACE</span>
        <h1>{title}</h1>
        <p>操作系统课程 AI 助教 · V0.2 教学与学习平台</p>
      </header>
      {children}
    </>
  );
}
export function Notice({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="notice">
      {error}
    </p>
  ) : null;
}
export function ChapterSelect({
  value,
  onChange,
  chapters,
}: {
  value: number;
  onChange: (id: number) => void;
  chapters: Chapter[];
}) {
  return (
    <label>
      选择章节{" "}
      <select
        aria-label="选择章节"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {chapters.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </label>
  );
}
export function useChapters() {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    courseApi
      .chapters()
      .then(setChapters)
      .catch((e) => setError(e.message));
  }, []);
  return { chapters, error };
}
