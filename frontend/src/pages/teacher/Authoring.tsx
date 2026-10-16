import { ReactNode } from "react";
import { Link } from "react-router-dom";
export function AuthoringPage({
  title,
  description,
  back,
  children,
}: {
  title: string;
  description?: string;
  back?: { to: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="authoring-page">
      {back && (
        <Link className="authoring-back" to={back.to}>
          ← {back.label}
        </Link>
      )}
      <header className="authoring-heading">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </header>
      {children}
    </div>
  );
}
export const editorSteps = [
  ["settings", "基本信息"],
  ["content", "编写内容"],
  ["resources", "资料与关联"],
  ["preview", "预览发布"],
  ["history", "版本记录"],
] as const;
export function EditorSteps({
  step,
  onSelect,
  disabled,
}: {
  step: string;
  onSelect: (step: string) => void;
  disabled: boolean;
}) {
  return (
    <nav className="authoring-steps" aria-label="知识点编写步骤">
      {editorSteps.map(([key, label], i) => (
        <button
          type="button"
          key={key}
          className={step === key ? "current" : ""}
          aria-current={step === key ? "step" : undefined}
          disabled={disabled}
          onClick={() => onSelect(key)}
        >
          <span>{i + 1}</span>
          {label}
        </button>
      ))}
    </nav>
  );
}
