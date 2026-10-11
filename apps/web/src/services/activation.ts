// Capture and remove the one-time fragment before Vue Router reads the URL.
// The secret stays in component memory and is never saved to browser storage.
export const initialActivationToken =
  new URLSearchParams(location.hash.slice(1)).get("activate") ?? "";
if (initialActivationToken)
  history.replaceState(history.state, "", location.pathname + location.search);
