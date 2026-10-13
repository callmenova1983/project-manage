// Choose the adapter once per document. Native links across the /demo/ boundary
// reload the app so demo data can never be submitted through the HTTP adapter.
export const embeddedDemo =
  window.location.pathname === "/demo" ||
  window.location.pathname.startsWith("/demo/");
export const browserDemo =
  embeddedDemo || import.meta.env.VITE_DEMO_MODE === "1";
export const routerBase = embeddedDemo ? "/demo/" : "/";
