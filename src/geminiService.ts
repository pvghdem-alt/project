import { GoogleGenAI } from "@google/genai";
import { DESIGN_SPECS } from "./constants";

let ai: GoogleGenAI | null = null;
let customApiKey: string | null = null;

export function setCustomApiKey(key: string) {
  if (!key || key.trim() === "") {
    customApiKey = null;
    ai = null;
    return;
  }
  customApiKey = key.trim();
  try {
    ai = new GoogleGenAI({ apiKey: customApiKey });
    console.log("Custom API Key set and AI client initialized.");
  } catch (e) {
    console.error("Invalid API Key format:", e);
    ai = null;
  }
}

export function getAiClient() {
  if (customApiKey) {
    if (!ai) {
      try {
        console.log("Initializing Gemini AI with custom key...");
        ai = new GoogleGenAI({ apiKey: customApiKey });
      } catch (e) {
        console.error("Failed to initialize Gemini AI with custom key:", e);
        return null;
      }
    }
    return ai;
  }
  
  if (!ai) {
    // Try process.env (mapped by Vite)
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey && apiKey !== "undefined" && apiKey !== "") {
        console.log("Initializing Gemini AI with system key...");
        ai = new GoogleGenAI({ apiKey: apiKey });
      } else {
        console.warn("GEMINI_API_KEY is not available in environment.");
        return null;
      }
    } catch (e) {
      console.warn("Accessing process.env.GEMINI_API_KEY failed or it is not defined.", e);
      return null;
    }
  }
  return ai;
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

export async function askAiAssistant(query: string) {
  let retries = 0;
  const maxRetries = 2;
  
  while (retries <= maxRetries) {
    try {
      const aiClient = getAiClient();
      if (!aiClient) {
        return "尚未完成 AI 設定。請在左側邊欄設定 API Key。";
      }
      
      const response = await aiClient.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{ role: 'user', parts: [{ text: query }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
        },
      });
      
      return response.text;
    } catch (error: any) {
      console.error(`AI Assistant Error (Attempt ${retries + 1}):`, error);
      
      // Handle Rate Limit (429)
      if (error?.status === 429 || error?.code === 429) {
        if (retries < maxRetries) {
          retries++;
          const delay = Math.pow(2, retries) * 1000;
          console.warn(`Gemini API Rate Limited. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        return "AI 目前負載過高 (Rate Limit)，請稍候再試。";
      }

      return "抱歉，AI 助理目前遇到錯誤。請確認您的 API Key 是否正確且具備權限。";
    }
  }
  return "AI 助理連線逾時，請稍後再試。";
}

export async function analyzeNotesToRequirements(currentRequirements: any[], confirmedNotes: any[], selectedSpace: string) {
  let retries = 0;
  const maxRetries = 2;

  while (retries <= maxRetries) {
    try {
      const aiClient = getAiClient();
      if (!aiClient) throw new Error("AI client not initialized");
      
      const prompt = `
### 目前空間：${selectedSpace} ###

### 現有「${selectedSpace}」相關規範資料 ###
${JSON.stringify(currentRequirements.map(r => ({ title: r.title, points: r.points })), null, 2)}

### 最新會議討論紀錄 (New Meeting Notes) ###
${JSON.stringify(confirmedNotes.map(n => n.content), null, 2)}

任務：請將「最新會議討論紀錄」內容彙整進「現有規範資料」中，產出專屬於「${selectedSpace}」的完整工程規範。
    
### 執行指令 (Directives) ###
1. **分類整理 (嚴格要求)**：將所有規範依據工程類別進行「標題 (Title)」分類。
   * 妳 **必須** 優先且僅能將內容歸類至以下 12 個類別：
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
     - **護士呼叫系統** (註：護士呼叫、對講系統務必歸於此類，不得歸類於消防設備)
2. **去重與語意合併**：如果新紀錄的內容與現有的規範項目（points）重複、語意相同或高度重疊，則「絕對不要重複新增」。請將新舊內容合併為一條最完整且清晰的描述。
3. **文字修飾與專業化 (核心要求)**：使用者紀錄的內容通常較為「白話」或「口語化」，妳 **必須** 協助將其修飾為專業的工程技術用語。
   * 例如：「插座要高一點」修飾為「插座安裝高度需配合後續維管需求提升高度至離地 120cm 以上（或適當高度）」。
   * 例如：「不要用軟管」修飾為「蓮蓬頭設施應採用無軟管式設計，以維繫病房安全」。
4. **原地保留與擴充**：
   * 除非新的紀錄內容與現有項目「有直接衝突」或「需要修正更新」，否則必須「完整保留」現有的所有規範項目。
   * 新的規範項目請增加在對應分類的 points 陣列之後。
5. **輸出格式**：必須是 JSON 陣列。格式：[{ title: string, points: string[] }]。
6. **專業用詞**：使用繁體中文專業建築/水電工程術語。
`;

      const result = await aiClient.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          systemInstruction: `妳是一位專業的建築規範分析師與資深編輯。妳擅長進行重複性檢查與資訊增量更新。妳必須確保現有的規範內容不被無故刪除，且新內容能精確歸類。`
        }
      });

      const text = result.text;
      if (!text) return null;
      
      // Clean JSON string if LLM returns markdown blocks
      const jsonStr = text.replace(/```json|```/gi, "").trim();
      return JSON.parse(jsonStr);
    } catch (error: any) {
      console.error(`AI Analysis Error (Attempt ${retries + 1}):`, error);
      if ((error?.status === 429 || error?.code === 429) && retries < maxRetries) {
        retries++;
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function deduplicateData(type: 'requirements' | 'checklist', data: any[]) {
  let retries = 0;
  const maxRetries = 1;

  while (retries <= maxRetries) {
    try {
      const aiClient = getAiClient();
      if (!aiClient) throw new Error("AI client not initialized");

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

      const result = await aiClient.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          systemInstruction: `妳是一位資深的數據清洗專家與工程合約編輯。妳的目標是將冗長的清單轉化為精煉、不重複且具備高度邏輯性的技術文獻。`
        }
      });

      const text = result.text;
      if (!text) return null;
      const jsonStr = text.replace(/```json|```/gi, "").trim();
      return JSON.parse(jsonStr);
    } catch (error: any) {
      console.error(`AI Cleanup Error (Attempt ${retries + 1}):`, error);
      if ((error?.status === 429 || error?.code === 429) && retries < maxRetries) {
        retries++;
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

export async function analyzeFileToSpecs(fileData: { data: string, mimeType: string }) {
  try {
    const aiClient = getAiClient();
    if (!aiClient) throw new Error("AI client not initialized");

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

    const result = await aiClient.models.generateContent({
      model: DEFAULT_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: fileData },
            { text: prompt }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        systemInstruction: `妳是一位專業的工程圖面與合約分析師。妳能精準辨識圖片或 PDF 文件中的手寫筆記、公文要點與圖面標註，並將其轉化為結構化的工程規範。格式務必嚴格遵守 JSON。`
      }
    });

    const text = result.text;
    if (!text) return null;
    const jsonStr = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("File Analysis Error:", error);
    return null;
  }
}
