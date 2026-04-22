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
  customApiKey = key;
  try {
    ai = new GoogleGenAI({ apiKey: key });
  } catch (e) {
    console.error("Invalid API Key format:", e);
    ai = null;
  }
}

function getAiClient() {
  if (customApiKey) {
    if (!ai) {
      try {
        ai = new GoogleGenAI({ apiKey: customApiKey });
      } catch (e) {
        console.error("Failed to initialize Gemini AI with custom key:", e);
        return null;
      }
    }
    return ai;
  }
  
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined.");
      return null;
    }
    try {
      ai = new GoogleGenAI({ apiKey: apiKey });
    } catch (e) {
      console.error("Failed to initialize Gemini AI with environment key:", e);
      return null;
    }
  }
  return ai;
}

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
  try {
    const aiClient = getAiClient();
    if (!aiClient) {
      return "尚未完成 AI 設定。請在左側邊欄設定 API Key。";
    }
    
    const response = await aiClient.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: query }] }],
      config: {
        systemInstruction: SYSTEM_PROMPT,
      },
    });
    
    return response.text;
  } catch (error: any) {
    console.error("AI Assistant Error:", error);
    return "抱歉，AI 助理目前遇到錯誤。請確認您的 API Key 是否正確且具備權限。";
  }
}

export async function analyzeNotesToRequirements(currentRequirements: any[], confirmedNotes: any[]) {
  try {
    const aiClient = getAiClient();
    if (!aiClient) throw new Error("AI client not initialized");
    
    const prompt = `
現有規範：
${JSON.stringify(currentRequirements, null, 2)}

最新的會議決議紀錄 (已確認)：
${JSON.stringify(confirmedNotes, null, 2)}

請根據以上資料，產出更新後的完整規範 JSON。`;

    const result = await aiClient.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        systemInstruction: `妳是一位專業的建築規範分析師與資深編輯。
任務：分析會議討論紀錄（Notes），將其中的核心「設計要求」或「規格決議」提取出來，並整合進現有的「工程規範（Requirements）」中。

規則：
1. **去重與彙整 (核心任務)**：務必檢查新提取的內容是否與現有規範重複。若內容相近或相同，請合併條目，不要產生冗餘的內容。
2. **邏輯歸類**：將新要求放入最貼切的類別中。若現有類別名稱不夠準確，可微調類別標題。
3. **輸出格式**：必須是純 JSON 陣列。物件格式：{ title: string, points: string[] }。
4. **語言風格**：專業、精煉的繁體中文工程規格。
5. **資料清理**：輸出的 points 應該是最終的決議描述，而非討論過程。`
      }
    });

    const text = result.text;
    if (!text) return null;
    
    // Clean JSON string if LLM returns markdown blocks
    const jsonStr = text.replace(/```json|```/gi, "").trim();
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return null;
  }
}

export async function deduplicateData(type: 'requirements' | 'checklist', data: any[]) {
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
${JSON.stringify(data, null, 2)}

請輸出清理後的完整 JSON 陣列。
${type === 'requirements' ? '物件格式: [{ title: string, points: string[] }]' : '物件格式: [{ text: string, checked: boolean, order: number }]'}
    `;

    const result = await aiClient.models.generateContent({
      model: "gemini-3-flash-preview",
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
  } catch (error) {
    console.error("AI Cleanup Error:", error);
    return null;
  }
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
      model: "gemini-3-flash-preview",
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
        systemInstruction: `妳是一位專業的工程圖面與合約分析師。妳能精準辨識圖片中的手寫筆記、公文要點與圖面標註，並將其轉化為結構化的工程規範。格式務必嚴格遵守 JSON。`
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
