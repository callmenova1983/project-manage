import { z } from "zod";
export const loginNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(64)
  .regex(
    /^[a-z][a-z0-9._-]*$/,
    "Login names must start with a letter and use letters, numbers, dots, underscores or hyphens.",
  );
