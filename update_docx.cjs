const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace standard TOC in docChildren.push
code = code.replace(
`        new Paragraph({
          text: "TOC_INDEX_ANCHOR"
        })`,
`        new TableOfContents("目錄", {
          hyperlink: true,
          headingStyleRange: "1-5",
        })`
);

// Replace Table definitions (2 occurrences)
code = code.replace(
`          const spaceTable = new Table({
            width: { size: "100%", type: WidthType.PERCENTAGE },`,
`          const spaceTable = new Table({
            width: { size: 9000, type: WidthType.DXA },`
);

code = code.replace(
`          const tradeTable = new Table({
            width: { size: "100%", type: WidthType.PERCENTAGE },`,
`          const tradeTable = new Table({
            width: { size: 9000, type: WidthType.DXA },`
);

const batchStart = "      // Add TOC via Docs API";
const batchEndStr = "      setNotification({ message: '成功匯出 Google Docs 細部設計需求書！可至雲端硬碟查看。', type: 'success' });";

let startIdx = code.indexOf(batchStart);
let endIdx = code.indexOf(batchEndStr);

if (startIdx > -1 && endIdx > -1) {
    code = code.substring(0, startIdx) + code.substring(endIdx);
}

fs.writeFileSync('src/App.tsx', code);
console.log('updated docx generation logic');
