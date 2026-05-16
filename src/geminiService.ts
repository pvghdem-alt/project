import { DESIGN_SPECS } from "./constants";

let customApiKey: string | null = null;

export function setCustomApiKey(key: string) {
  if (!key || key.trim() === "") {
    customApiKey = null;
    return;
  }
  customApiKey = key.trim();
  console.log("Custom API Key stored.");
}

const DEFAULT_MODEL = "gemini-2.0-flash";

const SYSTEM_PROMPT = `
你是一位專業的醫療空間設計顧問，正在協助工程承辦人員與護理長討論「屏東榮總龍泉分院B棟3F、5F改建工程」。
你的知識庫包含以下改建需求規範：

${JSON.stringify(DESIGN_SPECS.keyPoints, null, 2)}

樓層資訊：
- B3F: 慢性精神科急性病房 (44床)，含日光室、配膳間、護理站。
- B5F: 精神科急性病房 (30床)，含保護室、多功能活動室。

規則：
1. 回答需專業且溫馨，考量到精神科病人的安全性與照護便利性。
2. 針對保護室，強調面積需大於10m2，且開關需在前室控制。
3. 針對浴廁，強調無軟管、無插座、無止水墩設計。
4. **格式要求 (重要)**：請使用 Markdown 格式進行分段排版。使用標題 (###)、列表 (1. 或 -) 與粗體來強調重點，避免整整大段文字，增加閱讀舒適度。
5. 若使用者詢問不包含在規範中的內容，請基於一般醫療規範提供建議，並備註「建議與設計單位進一步確認」。
6. 回答請使用繁體中文。
`;

async function callGeminiApi(options: {
  query?: string;
  contents?: any[];
  systemInstruction?: string;
  model?: string;
  responseMimeType?: string;
}) {
  let retries = 0;
  const maxRetries = 3;
  
  while (retries <= maxRetries) {
    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...options,
          customApiKey
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const status = response.status;
        const message = errorData.error || response.statusText;
        
        if (status === 429) {
          if (retries < maxRetries) {
            retries++;
            // Exponential backoff: 2s, 4s, 8s
            // If the user hit a daily limit (limit: 0), this won't help, but for TPM/RPM it will.
            const backoff = Math.pow(2, retries) * 1000;
            console.warn(`Gemini API 429 (Rate Limited). Attempt ${retries} of ${maxRetries}. Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }
          throw new Error("AI 額度已達上限 (Quota Exceeded)。如果您使用的是免費版（Free Tier），請稍等約一分鐘或是確認每日配額是否已滿。");
        }
        
        throw new Error(message || `API Error ${status}`);
      }

      const data = await response.json();
      return data.text;
    } catch (error: any) {
      if (error.message?.includes("Quota Exceeded")) throw error;
      
      if (retries < maxRetries) {
        retries++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error("Gemini API Proxy Error:", error);
      throw error;
    }
  }
}

export async function askAiAssistant(query: string) {
  try {
    return await callGeminiApi({
      query,
      systemInstruction: SYSTEM_PROMPT,
      model: DEFAULT_MODEL
    });
  } catch (error: any) {
    console.error("askAiAssistant error:", error);
    throw new Error(error.message || "抱歉，AI 助理目前遇到錯誤。請稍後再試。");
  }
}

export async function analyzeNotesToRequirements(currentRequirements: any[], confirmedNotes: any[], selectedSpace: string) {
  const prompt = `
### 目前空間：${selectedSpace} ###

### 現有「${selectedSpace}」相關規範資料 ###
${JSON.stringify(currentRequirements.map(r => ({ title: r.title, points: r.points })), null, 2)}

### 最新會議討論紀錄 (New Meeting Notes) ###
${JSON.stringify(confirmedNotes.map(n => n.content), null, 2)}

任務：妳將執行「雙階段彙整」：第一步先分類整理現有的「現有規範資料」，第二步再將「最新會議討論紀錄」內容與其整合，最後產出專屬於「${selectedSpace}」的完整工程規範及一份「異動報告」。
    
### 執行指令 (Directives) ###
1. **雙階段整合 (重點)**：
   * 第一步：請將現有的資料庫內容依據下方規定的 12 個類別進行分類整理。
   * 第二步：對比最新會議紀錄，將新需求加入對應類別，並確保敘述風格統一且專業。
2. **分類整理與「強烈去重」 (嚴格要求)**：
   * 妳 **必須** 優先且僅能將內容歸類至以下 12 個類別。
   * **去重與語意合併**：如果內容重複、語意相同或高度重疊，妳 **必須** 將其合併。例如：「需設護士呼叫系統」與「具備護士呼叫功能」應合併為一條。
   * **位置校正**：確保項目歸類在正確標題下。例如「護士呼叫器」相關項目若出現在「消防設備」，妳 **必須** 將其移至「護士呼叫系統」。
   類別清單：
     - **醫療氣體設備**
     - **燈光控制**
     - **空調設備**
     - **衛浴設備**
     - **櫥櫃/家具**
     - **天花板**
     - **地面工程**
     - **牆壁/油漆**
     - **電力/資訊**
     - **消防設備**
     - **門窗工程**
     - **護士呼叫系統** (註：護士呼叫、對講系統務必歸於此類，不得歸類於其他類別)
3. **文字修飾與專業化 (核心要求)**：將「白話」或「口語化」內容修飾為專業的工程技術用語。
   * 例如：「插座要高一點」修飾為「插座安裝高度需配合後續維管需求提升高度至離地 120cm 以上（或適當高度）」。
4. **輸出格式**：必須是 JSON 物件。
   格式：
   {
     "requirements": [{ "title": string, "points": string[] }],
     "summary": {
       "added": string[],   // 列出本次新增的重點項目描述
       "merged": string[],  // 列出本次被合併或重複刪除的項目描述
       "updated": string[]  // 列出本次被語意優化的項目描述
     }
   }
5. **專業用詞**：使用繁體中文專業建築/水電工程術語。
`;

  try {
    const text = await callGeminiApi({
      query: prompt,
      responseMimeType: "application/json",
      systemInstruction: `妳是一位專業的建築規範分析師與資深編輯。妳擅長進行重複性檢查與資訊增量更新。妳必須確保現有的規範內容不被無故刪除，且新內容能精確歸類。妳的目標是產出完美去重且結構嚴謹的 JSON。`
    });

    if (!text) return null;
    const jsonStr = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("analyzeNotesToRequirements error:", error);
    throw error;
  }
}

export async function deduplicateData(type: 'requirements' | 'checklist', data: any[]) {
  const prompt = `
請協助彙整並清理以下${type === 'requirements' ? '工程規範' : '查檢清單'}資料。
目標：
1. **移除重複**：內容相同或語意高度重疊的項目必須合併。
2. **精簡彙整**：將零碎的細項進行邏輯歸併。
3. **保持專業**：使用專業的繁體中文工程術語。

待清理資料：
${JSON.stringify(data.map(d => {
  if (type === 'requirements') return { title: d.title, points: d.points };
  return { text: d.text, checked: d.checked };
}), null, 2)}

請輸出清理後的完整 JSON 陣列。
${type === 'requirements' ? '物件格式: [{ title: string, points: string[] }]' : '物件格式: [{ text: string, checked: boolean, order: number }]'}
`;

  try {
    const text = await callGeminiApi({
      query: prompt,
      responseMimeType: "application/json",
      systemInstruction: `妳是一位資深的數據清洗專家與工程合約編輯。妳的目標是將冗長的清單轉化為精煉、不重複且具備高度邏輯性的技術文獻。`
    });

    if (!text) return null;
    const jsonStr = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("deduplicateData error:", error);
    throw error;
  }
}

export async function analyzeFileToSpecs(fileData: { data: string, mimeType: string }) {
  const prompt = `
請分析這張截圖或文件中的工程需求，並將其分類整理為：
1. **Engineering Specifications (工程規範)**：技術參數、材質要求、尺寸規定。
2. **Checklist Items (查檢項目)**：需現場確認或查核的具體條目。

請輸出 JSON 格式：
{
  "requirements": [{ "title": string, "points": string[] }],
  "checklist": [{ "text": string }]
}
    `;

  try {
    const text = await callGeminiApi({
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: fileData },
            { text: prompt }
          ]
        }
      ],
      responseMimeType: "application/json",
      systemInstruction: `妳是一位專業的工程圖面與合約分析師。妳能精準辨識圖片或 PDF 文件中的手寫筆記、公文要點與圖面標註，並將其轉化為結構化的工程規範。格式務必嚴格遵守 JSON。`
    });

    if (!text) return null;
    const jsonStr = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(jsonStr);
  } catch (error: any) {
    console.error("analyzeFileToSpecs error:", error);
    throw error;
  }
}

