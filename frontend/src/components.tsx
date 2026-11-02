import { ReactNode } from "react";
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
        <p>操作系统课程 AI 助教 · V0.3 资料与智能问答平台</p>
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
