export interface PackFile { path: string; bytes: number; sha256: string; }
export interface ResourcePack { id: string; url: string; bytes: number; sha256: string; files: PackFile[]; }
export interface ResourceCatalog { schemaVersion: 1; packs: ResourcePack[]; owners: Record<string, string>; }
