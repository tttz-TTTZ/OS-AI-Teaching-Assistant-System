import { useState, useEffect } from "react";
export function useRemote<T>(load: () => Promise<T>, initial: T) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setData(await load());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return { data, error, loading, refresh, setError };
}
export function Publish({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      发布给学生（章节或课程为草稿时仍不可见）
    </label>
  );
}
export function Status({ value }: { value: boolean }) {
  return (
    <span className={`state ${value ? "published" : "draft"}`}>
      {value ? "已发布" : "草稿"}
    </span>
  );
}
