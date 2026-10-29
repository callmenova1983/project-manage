import "dotenv/config";
import { Repository } from "./database.js";
import { createUser } from "./auth.js";
import { z } from "zod";
const repo = await Repository.open();
try {
  const command = process.argv[2];
  if (command === "migrate") console.log("Database migrations applied");
  else if (command === "seed") {
    await repo.seed(process.env.PM_WORKSPACE_ID ?? "demo");
    console.log("Synthetic seed created");
  } else if (command === "user") {
    const input = z
      .object({
        email: z.string().email(),
        name: z.string().min(1).max(80),
        password: z.string().min(14).max(500),
        workspaceId: z.string().min(1),
      })
      .parse({
        email: process.env.PM_USER_EMAIL,
        name: process.env.PM_USER_NAME,
        password: process.env.PM_USER_PASSWORD,
        workspaceId: process.env.PM_WORKSPACE_ID ?? "demo",
      });
    await createUser(repo, input);
    console.log("User created");
  } else throw new Error("Use migrate, seed, or user");
} finally {
  await repo.close();
}
