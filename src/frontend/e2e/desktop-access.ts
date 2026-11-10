// The desktop app wants credentials with every request (docs/DESKTOP.md, "Security"). A browser
// gets a session cookie in exchange for a one-time code: desktop-setup.ts does that once, as the
// launcher's start address does, and saves the cookie as the storage state every context starts
// with. Set CFA_TOKEN (the content of the app's --token-file) and BASE_URL. Without CFA_TOKEN, as
// against the Docker stack, this adds nothing. desktop-access.spec.ts runs the way in itself.
import { tmpdir } from "node:os";
import { join } from "node:path";

export function desktopStateFile(): string | undefined {
  if (!process.env.CFA_TOKEN?.trim()) return undefined;
  const port = new URL(process.env.BASE_URL || "http://127.0.0.1").port;
  return join(tmpdir(), `cfa-desktop-state-${port}.json`);
}

export function desktopAccess(): { storageState?: string } {
  const file = desktopStateFile();
  return file ? { storageState: file } : {};
}
