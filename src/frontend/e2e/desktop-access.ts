// The desktop app wants credentials with every request (docs/DESKTOP.md, "Security"). A browser
// gets a session cookie in exchange for a one-time code: desktop-setup.ts does that once, as the
// launcher's start address does, and saves the cookie as the storage state every context starts
// with, in a private directory that it removes afterwards and names in CFA_STATE_FILE (the
// workers, which start after it, inherit that). Set CFA_TOKEN (the content of the app's
// --token-file) and BASE_URL. Without CFA_TOKEN, as against the Docker stack, this adds nothing.
// desktop-access.spec.ts runs the way in itself.
export function desktopAccess(): { storageState?: string } {
  const file = process.env.CFA_STATE_FILE;
  return file ? { storageState: file } : {};
}
