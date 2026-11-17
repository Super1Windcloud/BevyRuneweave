import { resourceCatalog } from "./resource-catalog.js";
import type { ResourceCatalog, ResourcePack } from "./resource-types.js";

interface Entry { pack: ResourcePack; state: "queued" | "pending" | "ready" | "error"; priority: number; request: number; received: number; root: string; error: string; }
/** Scheduling stays in TypeScript. Native workers own downloads, integrity checks and persistence. */
export class ResourceDownloads {
  private entries = new Map<string, Entry>();
  constructor(private catalog: ResourceCatalog = resourceCatalog) {}
  ensure(paths: string[], priority = 0, retry = false): boolean {
    for (const path of paths) {
      const id = this.catalog.owners[path]; if (!id) continue;
      let entry = this.entries.get(id);
      if (!entry) {
        const pack = this.catalog.packs.find((pack) => pack.id === id); if (!pack) throw new Error(`Missing resource pack ${id}`);
        entry = { pack, state: "queued", priority, request: 0, received: 0, root: "", error: "" }; this.entries.set(id, entry);
      }
      entry.priority = Math.max(priority, entry.priority);
      if (retry && entry.state === "error") { entry.state = "queued"; entry.received = 0; entry.error = ""; }
    }
    return paths.every((path) => this.ready(path));
  }
  ready(path: string): boolean { const id = this.catalog.owners[path]; return !id || this.entries.get(id)?.state === "ready"; }
  path(path: string): string { const id = this.catalog.owners[path]; if (!id) return path; const entry = this.entries.get(id); return entry?.state === "ready" ? entry.root + path : ""; }
  tick(): boolean {
    let changed = false;
    for (const entry of this.entries.values()) if (entry.state === "pending") {
      const result = asset_pack_poll(entry.request);
      if (result.state === "pending") entry.received = Math.min(entry.pack.bytes, Math.max(0, result.received));
      else {
        changed = true;
        if (result.state === "ready") { entry.state = "ready"; entry.root = result.root; entry.received = entry.pack.bytes; }
        else { entry.state = "error"; entry.error = result.state === "error" ? result.error : "unknown_request"; }
      }
    }
    let available = 2 - [...this.entries.values()].filter((entry) => entry.state === "pending").length;
    for (const entry of [...this.entries.values()].filter((entry) => entry.state === "queued").sort((a, b) => b.priority - a.priority)) {
      if (available <= 0) break;
      if (typeof asset_pack_request !== "function" || typeof asset_pack_poll !== "function") { entry.state = "error"; entry.error = "runtime_update_required"; changed = true; continue; }
      const { id: _, ...descriptor } = entry.pack;
      entry.request = asset_pack_request(JSON.stringify(descriptor));
      if (!entry.request) { entry.state = "error"; entry.error = "busy"; changed = true; continue; }
      entry.state = "pending"; available--;
    }
    return changed;
  }
  status(paths?: string[]): { received: number; total: number; error: string; ready: boolean } {
    const ids = paths ? new Set(paths.map((path) => this.catalog.owners[path]).filter(Boolean)) : null;
    const entries = [...this.entries.values()].filter((entry) => !ids || ids.has(entry.pack.id));
    return { received: entries.reduce((n, e) => n + e.received, 0), total: entries.reduce((n, e) => n + e.pack.bytes, 0),
      error: entries.find((entry) => entry.state === "error")?.error ?? "", ready: paths ? paths.every((path) => this.ready(path)) : entries.every((entry) => entry.state === "ready") };
  }
}
export const resources = new ResourceDownloads();
