import { taskReviewInstruction } from './instructions.js';
import type { Task } from "../../../../packages/domain/types.js";
import {
  taskReviewOutput,
  type TaskReviewOutput,
} from "../../../../packages/domain/task-review.js";
import { AiError } from "./provider.js";
import type { QwenConfig } from "./config.js";
import {
  timeZoneInput,
  zonedDay,
} from "../../../../packages/domain/time-zone.js";

export function makeTaskReviewRequest(
  task: Task,
  config: QwenConfig,
  timeZone = "UTC",
  now = new Date(),
) {
  timeZoneInput.parse(timeZone);
  return {
    model: config.model,
    stream: false,
    enable_thinking: false,
    enable_search: false,
    response_format: { type: "json_object" },
    max_tokens: config.maxTokens,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: taskReviewInstruction(timeZone),
      },
      {
        role: "user",
        content: JSON.stringify({
          today: zonedDay(now, timeZone),
          timeZone,
          task,
        }),
      },
    ],
  };
}
export function validateTaskReview(
  value: unknown,
  task: Task,
): TaskReviewOutput {
  const parsed = taskReviewOutput.safeParse(value);
  const source = task.title + "\n" + task.description;
  if (
    !parsed.success ||
    parsed.data.questions.some(
      (q) =>
        !source.includes(q.quote) ||
        q.choices.some(
          (c) =>
            (c.field === "dueDate" &&
              !/(截止|最晚|必须|之前|前完成|deadline|due\b|by\b)/i.test(
                q.quote,
              )) ||
            (c.field === "assignee" && !source.includes(c.value)),
        ),
    )
  )
    throw new AiError(
      502,
      "AI_INVALID_OUTPUT",
      "AI returned unsupported task details. The original task is saved.",
    );
  return parsed.data;
}
