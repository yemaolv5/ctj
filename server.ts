import express from "express";
import { createServer as createViteServer } from "vite";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ImageRun } from "docx";
import multer from "multer";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

// API routes
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

if (process.env.NODE_ENV !== "production") {
  startServer();
}

export default app;
