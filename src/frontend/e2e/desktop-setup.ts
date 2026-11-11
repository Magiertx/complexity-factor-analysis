import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs once before the specs: with the launch's token, asks the desktop app for a one-time code,
// redeems it like a browser opening the start address, and saves the session cookie it gets.
// The state goes into a directory only this user can enter (mkdtemp: mode 0700, a name nobody can
// guess or plant), in a new file with mode 0600, and is removed when the run ends.
export default async function globalSetup(): Promise<(() => Promise<void>) | void> {
  if (!process.env.CFA_TOKEN?.trim()) return;
  const base = process.env.BASE_URL!;
  const login = await fetch(`${base}/_desktop/login`, { headers: { "X-Desktop-Instance": process.env.CFA_TOKEN!.trim() } });
  if (!login.ok) throw new Error(`The app gave no login code: HTTP ${login.status}`);
  const { code } = (await login.json()) as { code: string };
  const redeemed = await fetch(`${base}/?token=${code}`, { redirect: "manual" });
  const cookie = redeemed.headers.getSetCookie().find((c) => c.startsWith("desktop_access_"));
  if (redeemed.status !== 303 || !cookie) throw new Error(`The code was not accepted: HTTP ${redeemed.status}`);
  const [pair] = cookie.split(";");
  const [name, value] = [pair.slice(0, pair.indexOf("=")), pair.slice(pair.indexOf("=") + 1)];
  const url = new URL(base);
  const dir = mkdtempSync(join(tmpdir(), "cfa-e2e-"));
  const file = join(dir, "state.json");
  process.env.CFA_STATE_FILE = file;
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [
        { name, value, domain: url.hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
      ],
      origins: [],
    }),
    { mode: 0o600, flag: "wx" },
  );
  return async () => {
    rmSync(dir, { recursive: true, force: true });
  };
}
