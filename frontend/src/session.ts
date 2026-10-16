// 这里只保存非敏感 Cookie 选择器；真正的会话令牌仍在 HttpOnly Cookie。
const KEY = "os:session-context";
function randomContext() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function sessionContext(): string {
  let value = sessionStorage.getItem(KEY);
  if (!value) {
    value = randomContext();
    sessionStorage.setItem(KEY, value);
  }
  return value;
}
function rotateSessionContext() {
  sessionStorage.setItem(KEY, randomContext());
}
const query = new URLSearchParams(window.location.search);
if (query.get("new_session") === "1") {
  rotateSessionContext();
  query.delete("new_session");
  history.replaceState(null, "", window.location.pathname +
    (query.size ? "?" + query.toString() : "") + window.location.hash);
}

// 复制标签页/window.open 会复制 sessionStorage。启动时探测现存页面，
// 副本使用新上下文并要求自行登录；普通刷新在原页面关闭后保留原上下文。
// 同时打开的两个副本均换新上下文也安全，绝不共享写入同一个 Cookie。
const owner = randomContext();
const channel = !navigator.locks && typeof BroadcastChannel !== "undefined"
  ? new BroadcastChannel("os:session-ownership") : null;
let occupied = false;
if (channel) {
  channel.onmessage = ({ data }) => {
    if (!data || data.owner === owner || data.context !== sessionContext()) return;
    if (data.type === "probe") {
      channel.postMessage({ type: "occupied", owner, context: data.context, target: data.owner });
    } else if (data.type === "occupied" && data.target === owner) {
      occupied = true;
    }
  };
  channel.postMessage({ type: "probe", owner, context: sessionContext() });
  window.addEventListener("pagehide", () => channel.close(), { once: true });
}
const broadcastReady = channel ? new Promise<void>((resolve) => {
  setTimeout(() => {
    if (occupied) rotateSessionContext();
    resolve();
  }, 180);
}) : Promise.resolve();

// Web Locks 的占用检查不依赖后台标签及时回复，现代浏览器优先采用它。
let releaseOwnership = () => {};
window.addEventListener("pagehide", () => releaseOwnership(), { once: true });
async function claimContext(): Promise<void> {
  if (!navigator.locks) return broadcastReady;
  let release!: () => void;
  const lifetime = new Promise<void>((resolve) => { release = resolve; });
  while (true) {
    const claimed = await new Promise<boolean>((resolve, reject) => {
      navigator.locks.request("os:session:" + sessionContext(), { ifAvailable: true },
        async (lock) => {
          if (!lock) { resolve(false); return; }
          const previous = releaseOwnership;
          releaseOwnership = release;
          previous();
          resolve(true);
          await lifetime;
        }).catch(reject);
    });
    if (claimed) return;
    rotateSessionContext();
  }
}
export const sessionReady = claimContext();
// 从浏览器往返缓存恢复时重新建立页面所有权，仍保留该标签的登录。
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
export async function freshSessionContext() {
  rotateSessionContext();
  await claimContext();
}
