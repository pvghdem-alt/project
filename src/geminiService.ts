import { DESIGN_SPECS } from "./constants";
import { GoogleGenerativeAI } from "@google/generative-ai";

let customApiKey: string | null = null;
let genAI: GoogleGenerativeAI | null = null;

export function setCustomApiKey(key: string) {
  if (!key || key.trim() === "") {
    customApiKey = null;
    genAI = null;
    return;
  }
  customApiKey = key.trim();
  genAI = new GoogleGenerativeAI(customApiKey);
  console.log("Custom API Key stored and initialized.");
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
  if (customApiKey && genAI) {
    const modelsToTry = [options.model || DEFAULT_MODEL, "gemini-1.5-pro", "gemini-1.5-flash"];
    let lastError: any = null;
    
    for (const modelToTry of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelToTry,
          systemInstruction: options.systemInstruction 
        });

        let result;
        if (options.contents) {
          result = await model.generateContent({
            contents: options.contents,
            generationConfig: {
              responseMimeType: options.responseMimeType || "text/plain",
            }
          });
        } else {
          result = await model.generateContent(options.query || "");
        }

        const response = await result.response;
        return response.text();
      } catch (clientError: any) {
        console.warn(`Client-side Gemini call failed for model ${modelToTry}:`, clientError);
        lastError = clientError;
        
        // If it's a 404 (not found) and we have more models to try, continue to the next one
        if (clientError.message?.includes("not found") || clientError.status === 404 || clientError.message?.includes("404")) {
          continue;
        }

        break; // Stop trying models if it's not a 404 error
      }
    }
    
    // If we're here, all models failed or a non-404 error occurred
    if (window.location.hostname.includes("github.io") && lastError) {
      if (lastError.message?.includes("429") || lastError.status === 429) {
        throw new Error("AI 額度已達上限 (Quota Exceeded)。請稍後再試，或在「API KEY 已設定」頁面更換另一組沒有超額的 API Key。");
      }
      throw new Error(`AI 呼叫失敗：${lastError.message || "請檢查您的 API Key 是否正確且具備 Gemini API 存取權限。"}`);
    }
  }

  let retries = 0;
  const maxRetries = 2;
  
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
        // If we get a 404 or 405, it confirms the proxy route doesn't exist (e.g. GitHub Pages)
        if (response.status === 404 || response.status === 405) {
          if (!customApiKey) {
            throw new Error("此環境不支援伺服器端 AI。請點擊左下角「API KEY」並設定您自己的 Gemini API Key 即可在 GitHub Pages 使用。");
          }
        }

        const errorData = await response.json().catch(() => ({}));
        const status = response.status;
        const message = errorData.error || response.statusText;
        
        if (status === 429) {
          if (retries < maxRetries) {
            retries++;
            const backoff = Math.pow(2, retries) * 1000;
            await new Promise(resolve => setTimeout(resolve, backoff));
            continue;
          }
          throw new Error("AI 額度已達上限。請稍後再試或檢查您的 API Key。");
        }
        
        throw new Error(message || `API Error ${status}`);
      }

      const data = await response.json();
      return data.text;
    } catch (error: any) {
      if (retries < maxRetries) {
        retries++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      console.error("Gemini API Error:", error);
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

### 現有規範資料 ###
${JSON.stringify(currentRequirements.map(r => ({ title: r.title, points: r.points })), null, 2)}

### 最新會議討論紀錄 (New Meeting Notes) ###
${JSON.stringify(confirmedNotes.map(n => n.content), null, 2)}

任務：妳將執行「雙階段彙整」：
第一步：將「最新會議討論紀錄」中原本白話的內容，大幅潤飾成專業的醫療建築與機電工程技術用語。
第二步：將所有潤飾後的新需求，以及「現有規範資料」，共同進行分類整理與強烈去重，最後產出專屬於「${selectedSpace}」的完整工程規範及一份「異動報告」。
    
### 執行指令 (Directives) ###
1. **嚴格分類 (重點)**：
   * 妳 **必須且只能** 將所有內容（包含現有規範與新紀錄）歸類至以下 12 個類別，**絕對不可自行發明其他類別名稱**（例如不可使用「護理站設計規範」或「特殊規範」等舊有標題）：
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
     - **護士呼叫系統** (註：對講系統務必歸於此類)
2. **強烈去重與語意合併 (嚴格要求)**：
   * 【重要】在同一個類別中，如果「現有規範」與「新會議紀錄」存在相似、重疊的內容，**妳必須將它們合併成一條完整的敘述，絕對不可以保留兩條意思相近的項目**！
   * 例如：現有規範「護理站與走道空間需實體實體牆物理區隔」，新紀錄「護理站要有獨立鎖固功能和獨立空間」，必須強烈合併為一條：「護理站須具備獨立鎖固功能，並與走道空間進行實體物理區隔。」而不是分別列出兩條。
3. **文字修飾與專業化 (核心要求)**：
   * 將「白話」或「口語化」內容修飾為專業的工程技術用語。例如：「插座要高一點」修飾為「插座安裝高度需配合後續維管需求提升高度至離地 120cm 以上」。
4. **輸出格式**：必須是嚴格的 JSON 格式。
   格式：
   {
     "requirements": [{ "title": string, "points": string[] }],
     "summary": {
       "added": string[],   // 列出本次新增的重點項目描述
       "merged": string[],  // 列出本次被合併或重複刪除的項目描述
       "updated": string[]  // 列出本次被語意優化的項目描述
     }
   }
`;

  try {
    const text = await callGeminiApi({
      query: prompt,
      responseMimeType: "application/json",
      systemInstruction: `妳是一位極度嚴格的建築規範與機電工程分析師。妳擅長大幅度潤飾白話文稿，並將資訊進行超強力的合併與去重。妳唯一的產出是一份邏輯完美、用字專業且絕對沒有任何重複內容的 JSON 結構。嚴禁創建規定以外的類別名稱。`
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

