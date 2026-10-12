/** In-memory navigation only. The workspace store resets this on account changes. */
export function initialProjectNavigation() {
  return {
    query: "",
    stage: "",
    owner: "",
    discipline: "",
    category: "",
    sort: "updated",
    expanded: "",
    insightsOpen: false,
    scope: "week" as "week" | "today",
    returnFocus: "",
  };
}
