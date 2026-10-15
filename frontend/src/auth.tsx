import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { authApi, User, setCsrfToken } from "./api";
type Auth = {
  user: User | null;
  loading: boolean;
  error: string;
  login: (name: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const Context = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  function assign(u: User | null) {
    setUser(u);
    setCsrfToken(u?.csrf_token || "");
  }
  useEffect(() => {
    let active = true;
    const expired = () => {
      assign(null);
      setError("请登录；原登录状态可能已过期。");
    };
    window.addEventListener("auth-expired", expired);
    authApi
      .me()
      .then((u) => {
        if (active) {
          assign(u);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
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
  async function login(name: string, password: string) {
    const u = await authApi.login(name, password);
    assign(u);
    setError("");
  }
  async function logout() {
    await authApi.logout();
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
