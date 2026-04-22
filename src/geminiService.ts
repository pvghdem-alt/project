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
    ai = new GoogleGenAI(key);
  } catch (e) {
    console.error("Invalid API Key format:", e);
    ai = null;
  }
}

function getAiClient() {
  if (customApiKey) {
    if (!ai) {
      try {
        ai = new GoogleGenAI(customApiKey);
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
      ai = new GoogleGenAI(apiKey);
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
4. 若使用者詢問不包含在規範中的內容，請基於一般醫療規範提供建議，並備註「建議與設計單位進一步確認」。
5. 回答請使用繁體中文。
`;

export async function askAiAssistant(query: string) {
  try {
    const client = getAiClient();
    if (!client) {
      return "尚未完成 AI 設定。請在左側邊欄設定 API Key。";
    }
    const model = client.getGenerativeModel({
      model: "gemini-1.5-flash",
      systemInstruction: SYSTEM_PROMPT,
    });
    
    const response = await model.generateContent(query);
    return response.response.text();
  } catch (error: any) {
    console.error("AI Assistant Error:", error);
    return "抱歉，AI 助理目前遇到錯誤。請確認您的 API Key 是否正確且具備權限。";
  }
}
