/** In-memory navigation only. The workspace store resets this on account changes. */
export function initialProjectNavigation() {
  return {
    lifecycle: "active" as "active" | "closed" | "archived" | "all",
    query: "",
    followedOnly: false,
    stage: "",
    owner: "",
    discipline: "",
    category: "",
    channel: "",
    sort: "manual",
    expanded: "",
    insightsOpen: false,
    scope: "week" as "week" | "today",
    returnFocus: "",
  };
}
