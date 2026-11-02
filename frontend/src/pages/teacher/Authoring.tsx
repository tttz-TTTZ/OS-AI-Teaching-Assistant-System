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
