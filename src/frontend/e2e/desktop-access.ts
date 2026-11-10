// The desktop app wants the access token of its launch with every request (docs/DESKTOP.md,
// "Security"). A browser gets it as a cookie from the start address `/?token=...`; here the cookie
// is put into the context directly. Set CFA_TOKEN (the content of the app's --token-file) and
// BASE_URL; without CFA_TOKEN, as against the Docker stack, this adds nothing.
export function desktopAccess(): {
  storageState?: {
    cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: "Strict" }[];
    origins: [];
  };
} {
  const token = process.env.CFA_TOKEN?.trim();
  if (!token) return {};
  const url = new URL(process.env.BASE_URL || "http://127.0.0.1");
  return {
    storageState: {
      cookies: [
        {
          name: `desktop_access_${url.port}`,
          value: token,
          domain: url.hostname,
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Strict",
        },
      ],
      origins: [],
    },
  };
}
