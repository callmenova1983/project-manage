// Synthetic names with the same numbering, gaps and repeated clients as a pasted order list.
export const projectListRows = [4, 6, 7, 8, 10, 11, 15, 19, 20, 21, 22].map(
  (number, index) => ({
    number,
    name: `合成建档项目${index + 1}`,
    client: `合成客户${index === 8 ? 1 : index === 10 ? 10 : index + 1}有限公司`,
  }),
);
export const projectListSource = projectListRows
  .map((row) => `${row.number}\t${row.name}\t${row.client}`)
  .join("\n\t\t\n");
