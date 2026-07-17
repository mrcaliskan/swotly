import * as SecureStore from "expo-secure-store";

/* Polite client for pollinations: anonymous tier allows 1 concurrent request
   with ~6s spacing; a free key (enter.pollinations.ai) lifts the pace. */
const KEY = "swotly_pollinations_key";
const DEFAULT_POLLI_KEY = "sk_6IHuII0Cpogi2HMrOqIiD7c3w9Drfzu4"; // embedded at build time
export const getPolliKey = async () => (await SecureStore.getItemAsync(KEY)) || DEFAULT_POLLI_KEY || null;
export const setPolliKey = (k: string) => SecureStore.setItemAsync(KEY, k.trim());
export const clearPolliKey = () => SecureStore.deleteItemAsync(KEY);

let last = 0;
let chain: Promise<void> = Promise.resolve();
export function politeSlot(): Promise<void> {
  const run = async () => {
    const key = await getPolliKey();
    const gap = key ? 1200 : 6500;
    const wait = Math.max(0, last + gap - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
  };
  const p = chain.then(run);
  chain = p.catch(() => {});
  return p;
}
export async function withKeyParam(url: string): Promise<string> {
  if (!/pollinations\.ai/.test(url)) return url; // never leak the key to Openverse/Wikipedia/Pexels
  const key = await getPolliKey();
  return key ? `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}` : url;
}
