import ts from "typescript";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// vue-office ships its PDF runtime as JS strings and normally executes data:
// scripts. Serve the identical runtime as local files to preserve script-src self.
const input = fileURLToPath(
  new URL("../node_modules/@vue-office/pdf/lib/index.js", import.meta.url),
);
const output = fileURLToPath(
  new URL("../apps/web/public/office-assets/", import.meta.url),
);
mkdirSync(output, { recursive: true });
const ast = ts.createSourceFile(
  input,
  readFileSync(input, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const found = new Set();
function visit(node) {
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer &&
    ts.isNoSubstitutionTemplateLiteral(node.initializer) &&
    node.initializer.text.length > 100000 &&
    ["R", "_e"].includes(node.name.text)
  ) {
    const name = node.name.text === "R" ? "pdf.worker.js" : "pdf.js";
    writeFileSync(output + name, node.initializer.text);
    found.add(name);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (found.size !== 2)
  throw new Error(
    "vue-office PDF runtime changed; update the static runtime copier before building.",
  );
