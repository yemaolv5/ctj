import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } from "docx";
import multer from "multer";
import { GoogleGenAI } from "@google/genai";

const app = express();
const PORT = 3000;

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

app.use(express.json({ limit: '50mb' }));

// API routes
app.get("/api/debug", (req, res) => {
  res.json({
    env: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    geminiKeyLength: process.env.GEMINI_API_KEY?.length || 0,
  });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const { image, grade } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    console.log(`[DEBUG] Analyze request received at ${new Date().toISOString()}`);
    console.log(`[DEBUG] Grade: ${grade}`);
    console.log(`[DEBUG] Image data length: ${image?.length || 0}`);
    console.log(`[DEBUG] Gemini API Key configured: ${!!apiKey}`);

    if (!apiKey) {
      console.error("[ERROR] GEMINI_API_KEY is missing");
      return res.status(500).json({ error: "服务器未配置 GEMINI_API_KEY，请在环境变量中设置。" });
    }

    const prompt = `你是一个专业的教育专家。请分析这张包含${grade}错题的图片。
请提供以下 JSON 格式的回复：
{
  "ocrText": "题目原文内容",
  "knowledgePoints": ["知识点1", "知识点2"],
  "solution": "详细的分步解答过程，使用 Markdown 格式",
  "similarQuestions": [
    {
      "difficulty": "简单",
      "question": "一道类似的简单变式题",
      "analysis": "该变式题的解析"
    },
    {
      "difficulty": "中等",
      "question": "一道类似的中等难度变式题",
      "analysis": "该变式题的解析"
    },
    {
      "difficulty": "困难",
      "question": "一道类似的较难变式题",
      "analysis": "该变式题的解析"
    }
  ]
}
只返回 JSON 内容，不要包含任何 Markdown 代码块标记或额外文字。`;

    // Extract base64 data and mime type
    const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return res.status(400).json({ error: "无效的图片格式" });
    }
    const mimeType = matches[1];
    const base64Data = matches[2];

    const result = await genAI.models.generateContent({
      model: "gemini-1.5-flash",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType,
                data: base64Data
              }
            },
            { text: prompt }
          ]
        }
      ]
    });

    const responseText = result.text;
    console.log("[DEBUG] Gemini Raw Response:", responseText);

    let data;
    try {
      // Clean up potential markdown blocks if the model ignored instructions
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const cleanJson = jsonMatch ? jsonMatch[0] : responseText;
      data = JSON.parse(cleanJson);
    } catch (e) {
      console.error("Failed to parse Gemini response as JSON:", responseText);
      return res.status(500).json({ error: "解析结果格式错误", raw: responseText });
    }

    res.json(data);
  } catch (error: any) {
    console.error("[ERROR] Analyze failed:", error);
    res.status(500).json({ error: "解析失败", details: error.message });
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
