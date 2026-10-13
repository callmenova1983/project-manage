export function clipboardContent(data: DataTransfer) {
  const files = Array.from(data.files),
    html = data.getData("text/html");
  let text = data.getData("text/plain"),
    remoteImages = false;
  if (html) {
    // Template contents stay inert: no scripts or external image loading.
    const template = document.createElement("template");
    template.innerHTML = html;
    const root = template.content;
    if (!files.length)
      for (const img of root.querySelectorAll("img")) {
        const src = img.getAttribute("src") ?? "",
          match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(
            src,
          );
        if (match) {
          const bytes = Uint8Array.from(atob(match[2]!), (c) =>
            c.charCodeAt(0),
          );
          files.push(
            new File(
              [bytes],
              `pasted-${files.length}.${match[1] === "jpeg" ? "jpg" : match[1]}`,
              { type: `image/${match[1]}` },
            ),
          );
        } else if (src) remoteImages = true;
      }
    if (!text) {
      root.querySelectorAll("script,style").forEach((e) => e.remove());
      root.querySelectorAll("tr").forEach((row) =>
        row.replaceWith(
          document.createTextNode(
            Array.from(row.querySelectorAll("td,th"))
              .map((c) => c.textContent)
              .join("\t") + "\n",
          ),
        ),
      );
      root
        .querySelectorAll("p,div,br")
        .forEach((e) => e.append(document.createTextNode("\n")));
      text = root.textContent ?? "";
    }
  }
  return { text, files, remoteImages };
}
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]!);
    reader.onerror = () => reject(new Error("The file could not be read"));
    reader.readAsDataURL(file);
  });
}
