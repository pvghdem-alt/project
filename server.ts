import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Gemini API Proxy
  app.post("/api/gemini", async (req, res) => {
    try {
      const { query, contents, systemInstruction, model, responseMimeType, customApiKey } = req.body;
      
      const apiKey = customApiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        return res.status(400).json({ error: "Missing Gemini API Key" });
      }

      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const modelsToTry = [model || "gemini-3-flash-preview", "gemini-1.5-pro", "gemini-1.5-flash"];
      let lastError: any = null;

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: contents || query,
            config: {
              systemInstruction,
              responseMimeType: responseMimeType || undefined,
            }
          });

          return res.json({ text: response.text });
        } catch (error: any) {
          const status = error?.status || 500;
          const message = error?.message || "Internal Server Error";
          
          if (status === 404 || status === 429 || message.includes("404") || message.includes("429") || message.includes("not found") || message.includes("Quota")) {
            console.warn(`Server-side Gemini call failed for model ${modelName}:`, message);
            lastError = error;
            continue;
          }
          
          throw error;
        }
      }
      
      throw lastError; // If all exhausted, throw the last error (usually 429)
    } catch (error: any) {
      console.error("Gemini API Error:", error);
      
      const status = error?.status || 500;
      const message = error?.message || "Internal Server Error";
      
      res.status(status).json({ 
        error: message, 
        status,
        details: error?.details
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
