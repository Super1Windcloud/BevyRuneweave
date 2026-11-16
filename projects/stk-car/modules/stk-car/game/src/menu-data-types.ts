export interface GuiNode { tag: string; attributes: Readonly<Record<string, string>>; children: readonly GuiNode[]; }
export interface MenuTrack { id: string; name: string; designer: string; image: string; laps: number; arena: boolean; groups: string; }
export interface MenuGrandPrix { id: string; name: string; tracks: string[]; }
export interface MenuData {
  pages: Record<string, GuiNode>;
  sources: Record<string, string>;
  translations: Record<string, string>;
  images: Record<string, { path: string; width: number; height: number; borders?: number[]; slices?: string[]; preserveHorizontal?: boolean }>;
  tracks: MenuTrack[];
  grandPrix: MenuGrandPrix[];
  credits: string[];
  achievements: { id: string; name: string; description: string }[];
}
