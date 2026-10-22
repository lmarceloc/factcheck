// Alimenta o servidor com uma transcrição, linha a linha, como se fosse ao vivo.
// Uso: npm run simulate -- examples/ensaio.txt [--intervalo 4] [--url http://localhost:3000]
import fs from "node:fs";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const file = positional[0] ?? "examples/ensaio.txt";
const base = flag("url", "http://localhost:3000");
const interval = Number(flag("intervalo", "4")) * 1000;
const token = process.env.OPERATOR_TOKEN;

async function post(path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-operator-token": token } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const lines = fs
  .readFileSync(file, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));

let current: string | null = null;
for (const line of lines) {
  const m = line.match(/^([\w-]+):\s*(.+)$/);
  if (!m) continue;
  const [, speakerId, text] = m;
  if (speakerId !== current) {
    await post("/api/speaker", { speakerId });
    current = speakerId;
  }
  // Mostra a fala "sendo dita" palavra por palavra antes de confirmar.
  const words = text.split(" ");
  for (let i = 4; i < words.length; i += 4) {
    await post("/api/transcript", { text: words.slice(0, i).join(" "), final: false });
    await sleep(Math.min(400, interval / 8));
  }
  await post("/api/transcript", { text, final: true });
  console.log(`${speakerId}: ${text}`);
  await sleep(interval);
}
await post("/api/flush", {});
console.log("\nFim da transcrição.");
