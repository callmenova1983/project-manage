import {
  DomainError,
  type Member,
  type ProjectInput,
  type TaskInput,
} from "./types.js";

export function memberName(
  id: string | null | undefined,
  fallback: string,
  members: readonly Member[],
) {
  return (
    (id && members.find((m) => m.id === id)?.name) || fallback || "Unassigned"
  );
}
function linkedMember(
  id: string,
  members: readonly Member[],
  retained: readonly string[],
) {
  const member = members.find((m) => m.id === id);
  if (!member) throw new DomainError("Choose a member from this workspace");
  if (member.status !== "active" && !retained.includes(id))
    throw new DomainError("Choose an active member for a new assignment");
  return member;
}
/** Never infer identity from text, including an exact or unique name match. */
export function projectMembers<T extends ProjectInput>(
  input: T,
  members: readonly Member[],
  old?: ProjectInput,
): T {
  const next = { ...input };
  if (next.ownerId === undefined && old?.ownerId && next.owner === old.owner)
    next.ownerId = old.ownerId;
  if (next.participantIds === undefined && old?.participantIds)
    next.participantIds = [...old.participantIds];
  if (next.ownerId)
    next.owner = linkedMember(
      next.ownerId,
      members,
      old?.ownerId ? [old.ownerId] : [],
    ).name;
  if (next.participantIds) {
    if (new Set(next.participantIds).size !== next.participantIds.length)
      throw new DomainError("Project participants must be unique");
    for (const id of next.participantIds)
      linkedMember(id, members, old?.participantIds ?? []);
  }
  return next;
}
export function taskMember<T extends TaskInput>(
  input: T,
  members: readonly Member[],
  old?: TaskInput,
): T {
  const next = { ...input };
  if (
    next.assigneeId === undefined &&
    old?.assigneeId &&
    next.assignee === old.assignee
  )
    next.assigneeId = old.assigneeId;
  if (next.assigneeId)
    next.assignee = linkedMember(
      next.assigneeId,
      members,
      old?.assigneeId ? [old.assigneeId] : [],
    ).name;
  return next;
}
