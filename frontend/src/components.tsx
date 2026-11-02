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
      <header className="page-heading">
        <h1>{title}</h1>
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
