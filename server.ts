import "dotenv/config";
import express from "express";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } from "docx";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Ultra-simple health check
app.get("/api/ping", (req, res) => {
  res.send("pong");
});

// API routes
app.get("/api/debug", (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY || "";
    res.json({
      status: "ok",
      env: process.env.NODE_ENV,
      hasGeminiKey: !!apiKey,
      geminiKeyLength: apiKey.length,
      geminiKeyPrefix: apiKey.substring(0, 4), // Should be AIza
      time: new Date().toISOString()
    });
  } catch (e: any) {
    res.status(500).json({ error: "Debug endpoint failed", message: e.message });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { image, grade } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const qwenKey = process.env.DASHSCOPE_API_KEY;
    const siliconKey = process.env.SILICONFLOW_API_KEY;

    if (!geminiKey && !qwenKey && !siliconKey) {
      return res.status(500).json({ error: "服务器未配置任何 AI 密钥 (GEMINI_API_KEY, DASHSCOPE_API_KEY 或 SILICONFLOW_API_KEY)。" });
    }

    const prompt = `你是一个专业的教育专家。请分析这张包含${grade}错题的图片。请提取题目内容、知识点、详细解答，并提供三道不同难度的变式题。`;

    // 1. 优先使用硅基流动 (SiliconFlow) - OpenAI 兼容接口
    if (siliconKey) {
      console.log("[DEBUG] Using SiliconFlow Engine (Streaming Mode)");
      
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const response = await fetch("https://api.siliconflow.cn/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${siliconKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: "Qwen/Qwen2.5-VL-7B-Instruct", // 升级到最新的 Qwen2.5-VL 模型
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: prompt },
                  { type: "image_url", image_url: { url: image } }
                ]
              }
            ],
            stream: true,
            response_format: { type: "json_object" }
          })
        });

        if (!response.body) throw new Error("SiliconFlow response body is null");
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let lineBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          lineBuffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed === 'data: [DONE]') continue;
            
            if (trimmed.startsWith('data: ')) {
              try {
                const json = JSON.parse(trimmed.slice(6));
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                  fullContent += content;
                  // 只发送增量片段 (delta)
                  res.write(`data: ${JSON.stringify({ delta: content })}\n\n`);
                }
              } catch (e) { /* 忽略解析错误 */ }
            }
          }
        }
        
        res.write(`data: ${JSON.stringify({ done: true, full: fullContent })}\n\n`);
        res.end();
        return;
      } catch (sfError: any) {
        console.error("[ERROR] SiliconFlow API failed:", sfError);
        return res.status(500).write(`data: ${JSON.stringify({ error: "硅基流动接口调用失败", details: sfError.message })}\n\n`);
      }
    }

    // 2. 次选通义千问 (DashScope)
    if (qwenKey) {
      console.log("[DEBUG] Using Qwen-VL-Max Engine (Streaming Mode)");
      
      // 设置 SSE 响应头，防止 Vercel 超时
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        const response = await fetch("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${qwenKey}`,
            "Content-Type": "application/json",
            "X-DashScope-SSE": "enable"
          },
          body: JSON.stringify({
            model: "qwen-vl-max",
            input: {
              messages: [
                {
                  role: "user",
                  content: [
                    { image: image },
                    { text: prompt }
                  ]
                }
              ]
            },
            parameters: {
              result_format: "message",
              incremental_output: true
            }
          })
        });

        if (!response.body) throw new Error("Qwen response body is null");
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          // 简单的 SSE 解析逻辑
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const json = JSON.parse(line.slice(5));
                const content = json.output?.choices?.[0]?.message?.content;
                if (content && typeof content === 'string') {
                  fullContent = content;
                  // 将内容实时发给前端
                  res.write(`data: ${JSON.stringify({ chunk: content })}\n\n`);
                }
              } catch (e) { /* 忽略心跳或非 JSON 行 */ }
            }
          }
        }
        
        // 最后发送一个完成标记，包含完整解析结果
        res.write(`data: ${JSON.stringify({ done: true, full: fullContent })}\n\n`);
        res.end();
        return;
      } catch (qwenError: any) {
        console.error("[ERROR] Qwen API failed:", qwenError);
        // 如果 Qwen 失败且有 Gemini Key，可以降级到 Gemini，但这里我们直接报错
        return res.status(500).write(`data: ${JSON.stringify({ error: "Qwen 接口调用失败", details: qwenError.message })}\n\n`);
      }
    }

    // 默认使用 Gemini (国外环境)
    const genAI = new GoogleGenAI({ apiKey: geminiKey! });
    const result = await genAI.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{
        parts: [
          { inlineData: { mimeType: image.match(/^data:([A-Za-z-+\/]+);base64/)[1], data: image.split(',')[1] } },
          { text: prompt }
        ]
      }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            ocrText: { type: "STRING" },
            knowledgePoints: { type: "ARRAY", items: { type: "STRING" } },
            solution: { type: "STRING" },
            similarQuestions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  difficulty: { type: "STRING" },
                  question: { type: "STRING" },
                  analysis: { type: "STRING" }
                },
                required: ["difficulty", "question", "analysis"]
              }
            }
          },
          required: ["ocrText", "knowledgePoints", "solution", "similarQuestions"]
        }
      }
    });

    res.json(JSON.parse(result.text));
  } catch (error: any) {
    console.error("[ERROR] Analyze failed:", error);
    res.status(500).json({ error: "解析失败", details: error.message || "服务器内部错误" });
  }
});

app.post("/api/export-word", async (req, res) => {
  try {
    const { grade, ocrText, knowledgePoints, solution, similarQuestions, image } = req.body;

    const children: any[] = [
      new Paragraph({
        text: "错题解析报告",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: `年级：${grade}`, bold: true }),
        ],
      }),
      new Paragraph({ text: "" }),
    ];

    // Add original image if provided
    if (image) {
      try {
        const base64Data = image.split(",")[1];
        const imageBuffer = Buffer.from(base64Data, 'base64');
        children.push(
          new Paragraph({
            text: "【错题原图】",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            children: [
              new ImageRun({
                data: imageBuffer,
                transformation: {
                  width: 500,
                  height: 300,
                },
              } as any),
            ],
          }),
          new Paragraph({ text: "" })
        );
      } catch (imgError) {
        console.error("Error adding image to Word:", imgError);
      }
    }

    children.push(
      new Paragraph({
        text: "【原题内容】",
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({ text: ocrText }),
      new Paragraph({ text: "" }),

      new Paragraph({
        text: "【知识点】",
        heading: HeadingLevel.HEADING_2,
      }),
      ...knowledgePoints.map((kp: string) => new Paragraph({ text: `• ${kp}`, bullet: { level: 0 } })),
      new Paragraph({ text: "" }),

      new Paragraph({
        text: "【正确解答与解析】",
        heading: HeadingLevel.HEADING_2,
      }),
      new Paragraph({ text: solution }),
      new Paragraph({ text: "" }),

      new Paragraph({
        text: "【变式训练】",
        heading: HeadingLevel.HEADING_2,
      }),
      ...similarQuestions.flatMap((q: any, index: number) => [
        new Paragraph({
          children: [
            new TextRun({ text: `题目 ${index + 1} (${q.difficulty})`, bold: true }),
          ],
        }),
        new Paragraph({ text: q.question }),
        new Paragraph({
          children: [
            new TextRun({ text: "解析：", italics: true }),
            new TextRun({ text: q.analysis }),
          ],
        }),
        new Paragraph({ text: "" }),
      ])
    );

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: children,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", "attachment; filename=analysis_report.docx");
    res.send(buffer);
  } catch (error) {
    console.error("Error generating Word document:", error);
    res.status(500).json({ error: "Failed to generate Word document" });
  }
});

// Global error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("[GLOBAL ERROR]", err);
  res.status(500).json({ error: "服务器内部错误", details: err.message });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

export default app;
