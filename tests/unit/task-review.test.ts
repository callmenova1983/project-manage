import { expect, it } from "vitest";
import { validateTaskReview } from "../../apps/api/src/ai/task-review";
import { taskSchema } from "../../packages/domain/types";

const task = taskSchema.parse({
  id: "task",
  version: 1,
  updatedAt: new Date().toISOString(),
  projectId: "project",
  parentId: null,
  title: "对方还没收到钱，下次沟通，估计十月底",
  description: "",
  status: "todo",
  assignee: "",
  dueDate: null,
  workDates: [],
  workWeek: null,
});
it("distinguishes estimated dates and reminders without inventing a deadline", () => {
  const result = validateTaskReview(
    {
      questions: [
        {
          question: "十月底是预计到账，还是沟通提醒（09:00）？",
          quote: "估计十月底",
          choices: [
            { label: "预计到账", field: "estimatedDate", value: "2026-10-31" },
            {
              label: "沟通提醒09:00",
              field: "reminderAt",
              value: "2026-10-31T09:00:00+08:00",
            },
          ],
        },
      ],
    },
    task,
  );
  expect(result.questions[0]?.choices.map((c) => c.field)).toEqual([
    "estimatedDate",
    "reminderAt",
  ]);
  expect(task.dueDate).toBeNull();
});
it("rejects invented evidence, unsupported deadlines and invalid dates", () => {
  for (const [quote, field, value] of [
    ["估计十月底", "dueDate", "2026-10-31"],
    ["必须十月底前完成", "dueDate", "2026-10-31"],
    ["估计十月底", "estimatedDate", "2026-02-30"],
    ["下次沟通", "reminderAt", "2026-10-31T09:00:00"],
    ["下次沟通", "assignee", "凭空出现的负责人"],
  ])
    expect(() =>
      validateTaskReview(
        {
          questions: [
            {
              question: "确认时间",
              quote,
              choices: [{ label: "确认", field, value }],
            },
          ],
        },
        task,
      ),
    ).toThrow();
  expect(validateTaskReview({ questions: [] }, task).questions).toEqual([]);
});
