// The desktop app wants credentials with every request (docs/DESKTOP.md, "Security"): a session
// cookie that a browser gets in exchange for a one-time code, or the launch's token as a bearer
// header for programs. The specs are a program: set CFA_TOKEN (the content of the app's
// --token-file) and every context sends the header. Without CFA_TOKEN, as against the Docker
// stack, this adds nothing. desktop-access.spec.ts runs the browser's way in.
export function desktopAccess(): { extraHTTPHeaders?: Record<string, string> } {
  const token = process.env.CFA_TOKEN?.trim();
  return token ? { extraHTTPHeaders: { Authorization: `Bearer ${token}` } } : {};
}
