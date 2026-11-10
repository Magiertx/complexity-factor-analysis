import { writeFileSync } from "node:fs";
import { desktopStateFile } from "./desktop-access";

// Runs once before the specs: with the launch's token, asks the desktop app for a one-time code,
// redeems it like a browser opening the start address, and saves the session cookie it gets.
export default async function globalSetup(): Promise<void> {
  const file = desktopStateFile();
  if (!file) return;
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
  writeFileSync(
    file,
    JSON.stringify({
      cookies: [
        { name, value, domain: url.hostname, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Strict" },
      ],
      origins: [],
    }),
  );
}
