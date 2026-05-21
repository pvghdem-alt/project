import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();

// 排程清理任務：每週日凌晨 3 點執行
export const scheduledDatabaseCleanup = onSchedule("0 3 * * 0", async (event) => {
  const db = admin.firestore();
  console.log("開始執行定期系統深度優化：掃描並清理各項重複及無效資料...");
  
  try {
    let totalDeleted = 0;
    const collectionsToClean = [
      { name: 'requirements', keyFn: (d: any) => `${d.title}|${d.space}` },
      { name: 'checklist', keyFn: (d: any) => `${d.text}` },
      { name: 'topics', keyFn: (d: any) => `${d.name}|${d.floorId}` },
      { name: 'notes', keyFn: (d: any) => `${d.content}|${d.space}` },
      { name: 'photos', keyFn: (d: any) => `${d.url?.substring(0, 20)}|${d.space}` },
    ];

    let currentBatch = db.batch();
    let operationsInBatch = 0;
    const batches = [currentBatch];

    for (const col of collectionsToClean) {
      const snapshot = await db.collection(col.name).get();
      const seen = new Set<string>();
      let deletedInCol = 0;

      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        
        // Generate unique key
        const key = col.keyFn(data);
        
        // Additional custom rules for completely invalid data
        const isInvalidReq = col.name === 'requirements' && !data.space && !data.title?.includes('B3F') && !data.title?.includes('B5F') && !data.title?.includes('病房') && !data.title?.includes('保護室');
        
        if (seen.has(key) || isInvalidReq) {
          currentBatch.delete(docSnap.ref);
          deletedInCol++;
          totalDeleted++;
          operationsInBatch++;
          
          // Firestore 每個 batch 最多 500 個操作，這裡我們抓 490 保險一點
          if (operationsInBatch === 490) {
            currentBatch = db.batch();
            batches.push(currentBatch);
            operationsInBatch = 0;
          }
        } else {
          if (key !== 'undefined|undefined' && key !== 'undefined') {
             seen.add(key);
          }
        }
      });
      console.log(`[${col.name}] 掃描完成，發現並標記刪除 ${deletedInCol} 筆重複/無效資料。`);
    }

    // 提交所有 batch
    for (const b of batches) {
      await b.commit();
    }

    console.log(`定期系統深度優化完成！共清理了 ${totalDeleted} 筆資料。`);
  } catch (error) {
    console.error("定期系統深度優化執行失敗:", error);
  }
});
