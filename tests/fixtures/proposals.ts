import type { Proposal, Suggestion } from "../../packages/domain/types";
import type { Repository } from "../../apps/api/src/database";
import type { WorkspaceApi } from "../../apps/web/src/services/contracts";
export type SuggestionFixture = Partial<Suggestion> & { title: string };
/** Stored test data, not an interpretation implementation. Decisions are supplied by each test. */
export function proposalFixture(
  source: string,
  items: SuggestionFixture[],
): Proposal {
  return {
    id: crypto.randomUUID(),
    source,
    sourceVersion: 1,
    status: "draft",
    createdAt: new Date().toISOString(),
    suggestions: items.map((item, index) => ({
      id: `line-${index + 1}`,
      sourceLine: index + 1,
      sourceText: item.title,
      candidates: [],
      selectedProjectId: "",
      action: "task",
      status: "todo",
      confirmed: false,
      overwriteConfirmed: false,
      ...item,
    })),
  };
}
export async function storedProposal(
  repo: Repository,
  workspaceId: string,
  source: string,
  items: SuggestionFixture[],
) {
  const proposal = proposalFixture(source, items);
  await repo.db
    .prepare("INSERT INTO proposals(id,workspace_id,data) VALUES(?,?,?)")
    .run(proposal.id, workspaceId, JSON.stringify(proposal));
  return proposal;
}
export async function storedProposalResponse(
  repo: Repository,
  workspaceId: string,
  payload: { source: string },
  items?: SuggestionFixture[],
) {
  const proposal = await storedProposal(
    repo,
    workspaceId,
    payload.source,
    items ??
      payload.source
        .split(/\r?\n/)
        .flatMap((title, index) =>
          title.trim()
            ? [{ title, sourceText: title, sourceLine: index + 1 }]
            : [],
        ),
  );
  return {
    statusCode: 200,
    body: JSON.stringify(proposal),
    json: <T = Proposal>() => structuredClone(proposal) as T,
  };
}
export async function localProposal(
  api: WorkspaceApi,
  source: string,
  items: SuggestionFixture[],
) {
  await api.snapshot();
  const data = JSON.parse(localStorage.getItem("project-manage-demo-v1")!);
  const proposal = proposalFixture(source, items);
  data.assistantProposals = [...(data.assistantProposals ?? []), proposal];
  localStorage.setItem("project-manage-demo-v1", JSON.stringify(data));
  return proposal;
}
