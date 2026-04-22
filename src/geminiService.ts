import { GoogleGenAI } from "@google/genai";
import { DESIGN_SPECS } from "./constants";

let ai: GoogleGenAI | null = null;
let customApiKey: string | null = null;

export function setCustomApiKey(key: string) {
  customApiKey = key;
  ai = new GoogleGenAI(key);
}

function getAiClient() {
  if (customApiKey) {
    if (!ai) ai = new GoogleGenAI(customApiKey);
    return ai;
  }
  
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not defined.");
    }
    ai = new GoogleGenAI(apiKey);
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
    const model = client.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: SYSTEM_PROMPT,
    });
    
    const response = await model.generateContent(query);
    return response.response.text();
  } catch (error: any) {
    console.error("AI Assistant Error:", error);
    if (error.message?.includes("API_KEY")) {
      return "尚未設定 API Key。請在 AI Studio 的 Secrets 面板中設定 GEMINI_API_KEY。";
    }
    return "抱歉，我現在無法回答這個問題。請確認網路連線或稍後再試。";
  }
}
