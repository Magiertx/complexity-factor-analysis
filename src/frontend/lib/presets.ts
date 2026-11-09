"use client";

const PREFIX = "app.presets-";

export type Preset = {
  name: string;
  params: Record<string, unknown>;
  createdAt: number;
};

function key(algorithmId: string): string {
  return `${PREFIX}${algorithmId}`;
}

function read(algorithmId: string): Preset[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key(algorithmId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Preset =>
        p && typeof p === "object" && typeof p.name === "string" && typeof p.params === "object" && p.params !== null,
    );
  } catch {
    return [];
  }
}

function write(algorithmId: string, presets: Preset[]): void {
  if (typeof window === "undefined") return;
  try {
    if (presets.length === 0) {
      localStorage.removeItem(key(algorithmId));
    } else {
      localStorage.setItem(key(algorithmId), JSON.stringify(presets));
    }
  } catch {
    /* localStorage full, presets are not persisted */
  }
}

/** Why saving or importing presets failed; the UI says it in its language by the code. */
export class PresetError extends Error {
  code: "empty_name" | "not_an_object" | "no_groups" | "no_presets";

  constructor(code: PresetError["code"], message: string) {
    super(message);
    this.name = "PresetError";
    this.code = code;
  }
}

export function listPresets(algorithmId: string): Preset[] {
  return read(algorithmId).sort((a, b) => a.name.localeCompare(b.name));
}

export function savePreset(algorithmId: string, name: string, params: Record<string, unknown>): Preset {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new PresetError("empty_name", "Preset name must not be empty.");
  }
  const presets = read(algorithmId).filter((p) => p.name !== trimmed);
  const preset: Preset = { name: trimmed, params, createdAt: Date.now() };
  presets.push(preset);
  write(algorithmId, presets);
  return preset;
}

export function deletePreset(algorithmId: string, name: string): void {
  const presets = read(algorithmId).filter((p) => p.name !== name);
  write(algorithmId, presets);
}

export function listAllPresets(): { algorithmId: string; presets: Preset[] }[] {
  if (typeof window === "undefined") return [];
  const out: { algorithmId: string; presets: Preset[] }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(PREFIX)) continue;
    const algorithmId = k.slice(PREFIX.length);
    const presets = listPresets(algorithmId);
    if (presets.length > 0) out.push({ algorithmId, presets });
  }
  return out.sort((a, b) => a.algorithmId.localeCompare(b.algorithmId));
}

export function clearAllPresets(): number {
  if (typeof window === "undefined") return 0;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
  return keys.length;
}

export type PresetExportFile = {
  version: 1;
  exportedAt: number;
  groups: { algorithmId: string; presets: Preset[] }[];
};

export function buildExportPayload(): PresetExportFile {
  return {
    version: 1,
    exportedAt: Date.now(),
    groups: listAllPresets(),
  };
}

export type ImportResult = {
  added: number;
  renamed: number;
  groups: number;
};

/**
 * Merge an imported export payload into existing presets without overwriting.
 * If a preset with the same name already exists for the same algorithm,
 * the imported one is renamed by appending " (imported)" (with a numeric
 * suffix if necessary). Throws if the payload is malformed.
 */
export function importPresets(payload: unknown): ImportResult {
  if (!payload || typeof payload !== "object") {
    throw new PresetError("not_an_object", "Invalid preset file: not a JSON object.");
  }
  const obj = payload as Record<string, unknown>;
  const groups = obj.groups;
  if (!Array.isArray(groups)) {
    throw new PresetError("no_groups", "Invalid preset file: missing 'groups' array.");
  }

  let added = 0;
  let renamed = 0;
  let touchedGroups = 0;

  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const group = g as { algorithmId?: unknown; presets?: unknown };
    const algorithmId = group.algorithmId;
    if (typeof algorithmId !== "string" || !algorithmId) continue;
    if (!Array.isArray(group.presets)) continue;

    const existing = read(algorithmId);
    const usedNames = new Set(existing.map((p) => p.name));
    let groupTouched = false;

    for (const p of group.presets) {
      if (!p || typeof p !== "object") continue;
      const incoming = p as { name?: unknown; params?: unknown; createdAt?: unknown };
      if (typeof incoming.name !== "string" || !incoming.name.trim()) continue;
      if (!incoming.params || typeof incoming.params !== "object") continue;

      let name = incoming.name.trim();
      if (usedNames.has(name)) {
        let candidate = `${name} (imported)`;
        let n = 2;
        while (usedNames.has(candidate)) {
          candidate = `${name} (imported ${n})`;
          n += 1;
        }
        name = candidate;
        renamed += 1;
      }
      usedNames.add(name);
      existing.push({
        name,
        params: incoming.params as Record<string, unknown>,
        createdAt: typeof incoming.createdAt === "number" ? incoming.createdAt : Date.now(),
      });
      added += 1;
      groupTouched = true;
    }

    if (groupTouched) {
      write(algorithmId, existing);
      touchedGroups += 1;
    }
  }

  if (added === 0) {
    throw new PresetError("no_presets", "No valid presets found in the file.");
  }

  return { added, renamed, groups: touchedGroups };
}
