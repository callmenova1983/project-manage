import { z } from "zod";
const schema = z
  .object({
    version: z.literal(1),
    ids: z.array(z.string().min(1).max(100)).max(1000),
  })
  .strict();
type StorageLike = Pick<Storage, "getItem" | "setItem">;
export function readFollowing(key: string, storage?: StorageLike) {
  try {
    const raw = (storage ?? localStorage).getItem(key);
    if (!raw) return { ids: [] as string[], unavailable: false };
    if (raw.length > 150000) throw Error();
    return {
      ids: [...new Set(schema.parse(JSON.parse(raw)).ids)],
      unavailable: false,
    };
  } catch {
    return { ids: [] as string[], unavailable: true };
  }
}
export function writeFollowing(
  key: string,
  ids: string[],
  storage?: StorageLike,
) {
  try {
    (storage ?? localStorage).setItem(
      key,
      JSON.stringify(schema.parse({ version: 1, ids: [...new Set(ids)] })),
    );
    return true;
  } catch {
    return false;
  }
}
