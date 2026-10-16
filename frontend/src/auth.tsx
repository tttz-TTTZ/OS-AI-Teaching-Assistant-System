import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  ReactNode,
} from "react";
import { authApi, User, setCsrfToken, invalidateAuthRequests } from "./api";
type Auth = {
  user: User | null;
  loading: boolean;
  error: string;
  login: (name: string, password: string, role?: "teacher" | "student") => Promise<void>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const revision = useRef(0);
  function assign(u: User | null) {
    setUser(u);
    setCsrfToken(u?.csrf_token || "");
  }
  useEffect(() => {
    let active = true;
    const expired = () => {
      revision.current += 1;
      invalidateAuthRequests();
      assign(null);
      setError("请登录；原登录状态可能已过期。");
    };
    window.addEventListener("auth-expired", expired);
    const initialRevision = revision.current;
    authApi
      .me()
      .then((u) => {
        if (active && initialRevision === revision.current) {
          assign(u);
          setError("");
        }
      })
      .catch((e) => {
        if (active && initialRevision === revision.current) {
          assign(null);
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.removeEventListener("auth-expired", expired);
    };
  }, []);
  async function login(name: string, password: string, role?: "teacher" | "student") {
    const current = ++revision.current;
    const u = await authApi.login(name, password, role);
    if (current !== revision.current) return;
    assign(u);
    setError("");
  }
  async function logout() {
    const current = ++revision.current;
    invalidateAuthRequests();
    // 保留当前 CSRF 供退出接口使用；接口成功才清理本地身份。
    setCsrfToken(user?.csrf_token || "");
    try {
      await authApi.logout();
    } catch (e) {
      if ((e as Error).name === "AbortError" || current !== revision.current) return;
      throw e;
    }
    if (current !== revision.current) return;
    invalidateAuthRequests();
    assign(null);
    setError("");
  }
  return (
    <Context.Provider value={{ user, loading, error, login, logout }}>
      {children}
    </Context.Provider>
  );
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw Error("AuthProvider missing");
  return value;
}
