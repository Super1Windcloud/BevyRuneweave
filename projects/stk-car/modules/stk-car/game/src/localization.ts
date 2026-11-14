import { menuData } from "./menu-data.js";

export type UiLanguage = "system" | "en-US" | "zh-CN";
let preference: UiLanguage = "system";
const systemLocale = typeof app_locale === "function" ? app_locale() : "en-US";
export function setUiLanguage(language: UiLanguage): void { preference = language; }
export function isChinese(): boolean { return /^zh(?:[-_]|$)/i.test(preference === "system" ? systemLocale : preference); }
export function tr(en: string, zh: string): string { return isChinese() ? zh : en; }
export function sourceText(text: string): string { return isChinese() ? menuData.translations[text] ?? text : text; }
