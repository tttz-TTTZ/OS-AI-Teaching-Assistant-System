import { useEffect, useRef, useState } from "react";
import { Content, digitalApi } from "../digital";
import { useAuth } from "../auth";
export function useAuthoring(id: number) {
  const { user } = useAuth();
  const key = `os:authoring:${user?.id}:${id}`;
  const [form, setForm] = useState<Content>();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [autosave, setAutosave] = useState(true);
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    generation.current += 1;
    setBusy(false);
    setMessage("");
    setAutosave(true);
    setLoading(true);
    setForm(undefined);
    setDirty(false);
    setError("");
    digitalApi
      .teacherDetail(id)
      .then((saved) => {
        if (!active) return;
        try {
          const cached = sessionStorage.getItem(key);
          if (cached) {
            const local = JSON.parse(cached) as Content;
            if (local.id === id) {
              setForm(local);
              setDirty(true);
              setMessage("已恢复本标签未保存的编辑，请检查后保存");
              if (local.edit_version !== saved.edit_version) {
                setAutosave(false);
                setError(
                  "已保存版本发生变化；保留了本地编辑，请先核对，避免覆盖其他教师。",
                );
              }
              return;
            }
          }
        } catch {
          /*失效的本地缓存不影响读取数据库。*/
        }
        setForm(saved);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      generation.current += 1;
    };
  }, [id, key]);
  useEffect(() => {
    if (dirty && form) sessionStorage.setItem(key, JSON.stringify(form));
  }, [dirty, form, key]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  async function save(automatic = false) {
    if (!form || busy) return false;
    if (!dirty) return true;
    if (!form.title.trim()) {
      setError("请填写知识点标题后再保存");
      return false;
    }
    const requestGeneration = generation.current;
    setBusy(true);
    setError("");
    try {
      const saved = await digitalApi.save(form);
      sessionStorage.removeItem(key);
      if (generation.current === requestGeneration) {
        setForm(saved);
        setDirty(false);
        setMessage(automatic ? "草稿已自动保存" : "草稿已保存");
      }
      return true;
    } catch (e) {
      if (generation.current === requestGeneration) {
        setError((e as Error).message);
        setAutosave(false);
      }
      return false;
    } finally {
      if (generation.current === requestGeneration) setBusy(false);
    }
  }
  useEffect(() => {
    if (!autosave || !dirty || busy || !form?.title.trim()) return;
    const timer = setTimeout(() => {
      void save(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, [autosave, dirty, busy, form]);
  function change(next: Content) {
    setForm(next);
    setDirty(true);
    setMessage("");
  }
  async function reload() {
    if (dirty && !confirm("放弃当前未保存编辑，重新读取已保存草稿？")) return;
    setBusy(true);
    setError("");
    try {
      const saved = await digitalApi.teacherDetail(id);
      sessionStorage.removeItem(key);
      setForm(saved);
      setDirty(false);
      setMessage("已重新读取草稿");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function accept(saved: Content) {
    setForm(saved);
    setDirty(false);
    sessionStorage.removeItem(key);
  }
  return {
    form,
    change,
    accept,
    dirty,
    busy,
    setBusy,
    loading,
    error,
    setError,
    message,
    setMessage,
    save,
    autosave,
    setAutosave,
    reload,
  };
}
