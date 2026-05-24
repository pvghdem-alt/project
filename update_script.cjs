const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const startMarker = "      const getImageData = async (photo: SpacePhoto)";
const endMarker = "        if (floorCount > 0) {\n          docChildren.push(...floorChildren);\n        }\n      }";

const startIndex = code.indexOf(startMarker);
const endIndex = code.indexOf(endMarker) + endMarker.length;

if (startIndex === -1 || endIndex === -1) {
  console.log("MARKERS NOT FOUND!", startIndex > -1, endIndex > -1);
  process.exit(1);
}

const replacement = `      const getImageData = async (photo: SpacePhoto): Promise<{ data: Uint8Array, width: number, height: number } | null> => {
        try {
          let blob: Blob | null = null;
          if (photo.driveFileId) {
            const res = await fetch(\`https://www.googleapis.com/drive/v3/files/\${photo.driveFileId}?alt=media\`, {
              headers: { Authorization: \`Bearer \${token}\` }
            });
            if (res.ok) blob = await res.blob();
          } else if (photo.url && !photo.url.startsWith('blob:')) {
            try {
              const res = await fetch(photo.url);
              if (res.ok) blob = await res.blob();
            } catch (err) {
              console.warn('CORS or fetch failed for url', err);
            }
          }

          if (!blob && photo.url) {
             if (photo.url.startsWith('data:image') || photo.url.startsWith('blob:')) {
                blob = await (await fetch(photo.url)).blob();
             }
          }

          if (!blob) return null;

          return await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 450;
              let width = img.width;
              let height = img.height;

              if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((b) => {
                  if (b) {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({ data: new Uint8Array(reader.result as ArrayBuffer), width, height });
                    reader.readAsArrayBuffer(b);
                  } else {
                    resolve(null);
                  }
                }, 'image/jpeg', 0.85);
              } else {
                resolve(null);
              }
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(blob!);
          });
        } catch (e) {
          console.warn('Image process failed', e);
          return null;
        }
      };

      // 1. Title Page
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 2000, after: 1000 },
          children: [
            new TextRun({ text: "屏東榮民總醫院龍泉分院", size: 52, bold: true }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "「龍泉分院B棟3F、5F改建工程委託", size: 36 }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "設計監造技術服務案(案號：1120101002)」", size: 36 }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 1400 },
          pageBreakBefore: false,
          children: [
            new TextRun({ text: "細部設計需求書", size: 40 }),
          ]
        }),
        new Paragraph({
          pageBreakBefore: true,
          text: "目錄",
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph({
          text: "TOC_INDEX_ANCHOR"
        })
      );

      // Loop over spaces
      for (const floor of projectMaps) {
        const floorSpaces = customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === floor.id || t.floorId === 'global'));
        if (floorSpaces.length === 0) continue;
        
        let floorCount = 0;
        
        const floorTitle = new Paragraph({
          text: \`\${floor.name} 空間需求\`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 400 },
          pageBreakBefore: true,
        });

        const floorChildren: any[] = [floorTitle];
        
        for (const space of floorSpaces) {
          const reqs = allRequirements.filter(r => r.space === space.name || (!r.space && (r.title === space.name || r.title.includes(space.name))));
          const photos = spacePhotos.filter(p => p.space === space.name);
          
          if (reqs.length === 0 && photos.length === 0) continue;
          floorCount++;
          
          const cellContent: any[] = [];
          
          if (reqs.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "需求項目：", bold: true, size: 28 })],
              spacing: { after: 200 }
            }));
            
            for (let i = 0; i < reqs.length; i++) {
              const req = reqs[i];
              cellContent.push(new Paragraph({
                children: [
                  new TextRun({ text: \`\${i + 1}. \${req.title}\`, bold: true, size: 24 })
                ],
                spacing: { before: 200, after: 100 }
              }));
              
              for (const pt of req.points) {
                cellContent.push(new Paragraph({
                  children: [new TextRun({ text: pt, size: 24 })],
                  bullet: { level: 0 },
                  spacing: { after: 100 }
                }));
              }
            }
          }
          
          if (photos.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "空間照片：", bold: true, size: 28 })],
              spacing: { before: 400, after: 200 }
            }));
            
            for (const photo of photos) {
              const imgData = await getImageData(photo);
              if (imgData) {
                cellContent.push(new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 100, after: 100 },
                  children: [
                    new ImageRun({
                      type: 'jpg',
                      data: imgData.data,
                      transformation: { width: imgData.width, height: imgData.height }
                    })
                  ]
                }));
              }
            }
          }
          
          const spaceTable = new Table({
            width: { size: "100%", type: WidthType.PERCENTAGE },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: "F1F5F9" },
                    children: [
                      new Paragraph({
                        text: space.name,
                        heading: HeadingLevel.HEADING_3,
                      })
                    ]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: cellContent.length > 0 ? cellContent : [new Paragraph({ text: "" })]
                  })
                ]
              })
            ]
          });
          
          // Use margin-bottom logic via paragraph spacing
          floorChildren.push(spaceTable, new Paragraph({ text: "", spacing: { after: 400 } }));
        }
        
        if (floorCount > 0) {
          docChildren.push(...floorChildren);
        }`;

code = code.substring(0, startIndex) + replacement + code.substring(endIndex);

// Do the same for globalTrades table
const tStartMarker = "          const tradeTable = new Table({";
const tEndMarker = "            ]\n          });";

const tStartIndex = code.indexOf(tStartMarker);
const tEndIndex = code.indexOf(tEndMarker) + tEndMarker.length;
const tReplacement = `          const tradeTable = new Table({
            width: { size: "100%", type: WidthType.PERCENTAGE },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: "F1F5F9" },
                    children: [
                      new Paragraph({
                        text: trade.name,
                        heading: HeadingLevel.HEADING_3,
                      })
                    ]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: cellContent.length > 0 ? cellContent : [new Paragraph({ text: "" })]
                  })
                ]
              })
            ]
          });`;

code = code.substring(0, tStartIndex) + tReplacement + code.substring(tEndIndex);

fs.writeFileSync('src/App.tsx', code);
console.log('updated table logic');
