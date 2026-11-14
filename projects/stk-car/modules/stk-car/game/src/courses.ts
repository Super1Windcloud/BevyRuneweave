import { dayCourseData } from "./day-course-data.js";
import { trackData } from "./track-data.js";

export interface Course {
  id: string; name: string; trackModel: string; skyModel: string; defaultLaps: number; music: string;
  route: readonly { center: readonly number[]; width: number }[];
  pickups: readonly { kind: string; position: readonly number[] }[];
  minimap: { minX: number; minZ: number; size: number; image: string };
  environment: { ambient: readonly number[]; brightness: number; sun: readonly number[]; illuminance: number; direction: readonly number[]; background: readonly number[]; fog: { color: readonly number[]; start: number; end: number } | null };
}
export const courses: readonly Course[] = [dayCourseData, {
  id: "lighthouse", name: "Around the Lighthouse", trackModel: trackData.trackModel, skyModel: trackData.skyModel,
  defaultLaps: trackData.defaultLaps, music: trackData.audio.race, route: trackData.route, pickups: trackData.pickups,
  minimap: { ...trackData.minimap, image: "ui/minimap.png" }, environment: trackData.environment,
}];
export const defaultCourse = courses[0];
export function courseFor(id: string): Course | undefined { return courses.find((course) => course.id === id); }
