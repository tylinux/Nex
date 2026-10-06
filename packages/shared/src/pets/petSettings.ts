import { PET_SIZE_DEFAULT_PX, PET_SIZE_MAX_PX, PET_SIZE_MIN_PX } from "./petFormat.js";
import type { PetSettings } from "./petTypes.js";

export function clampPetSize(size: number | undefined): number {
  if (size === undefined || !Number.isFinite(size)) return PET_SIZE_DEFAULT_PX;
  return Math.min(PET_SIZE_MAX_PX, Math.max(PET_SIZE_MIN_PX, Math.round(size)));
}

/**
 * ISettingService.update 对顶层字段是整块覆盖；宠物设置有多个写入方
 * （设置页、main 拖拽落定），都必须经此合并，避免互相抹掉对方的字段。
 * patch 中值为 undefined 的字段表示清除。
 */
export function mergePetSettings(
  current: PetSettings | undefined,
  patch: Partial<PetSettings>,
): PetSettings {
  const merged: PetSettings = {
    enabled: current?.enabled ?? false,
    petId: current?.petId ?? null,
    ...current,
    ...patch,
  };
  for (const key of Object.keys(merged) as (keyof PetSettings)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}
