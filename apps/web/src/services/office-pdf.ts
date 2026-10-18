type PdfWindow = Window & {
  pdfjsLib?: { GlobalWorkerOptions: { workerSrc: string } };
};
let pending: Promise<void> | undefined;
export function loadOfficePdf() {
  if (pending) return pending;
  pending = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/office-assets/pdf.js";
    script.onload = () => {
      const lib = (window as PdfWindow).pdfjsLib;
      if (!lib) {
        reject(Error("PDF runtime was not initialized"));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = `${window.location.origin}/office-assets/pdf.worker.js`;
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(Error("PDF runtime could not be loaded"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    pending = undefined;
    throw error;
  });
  return pending;
}
