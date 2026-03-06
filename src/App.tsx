import React, { useState, useRef, useCallback } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { 
  Upload, 
  FileText, 
  Loader2, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  BookOpen,
  Lightbulb,
  GraduationCap,
  BrainCircuit,
  Crop as CropIcon,
  X,
  Camera
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Markdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Cropper, { Area } from "react-easy-crop";
import confetti from "canvas-confetti";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const GRADES = ["小学", "初中", "高一", "高二", "高三"];

interface AnalysisResult {
  ocrText: string;
  knowledgePoints: string[];
  solution: string;
  similarQuestions: {
    difficulty: string;
    question: string;
    analysis: string;
  }[];
}

// Utility to crop image with rotation support
const getCroppedImg = async (imageSrc: string, pixelCrop: Area, rotation = 0): Promise<string> => {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => (image.onload = resolve));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("No 2d context");

  const rotRad = (rotation * Math.PI) / 180;
  // Calculate bounding box for rotation
  const { width: bWidth, height: bHeight } = {
    width: Math.abs(Math.cos(rotRad) * image.width) + Math.abs(Math.sin(rotRad) * image.height),
    height: Math.abs(Math.sin(rotRad) * image.width) + Math.abs(Math.cos(rotRad) * image.height),
  };

  canvas.width = bWidth;
  canvas.height = bHeight;

  ctx.translate(bWidth / 2, bHeight / 2);
  ctx.rotate(rotRad);
  ctx.translate(-image.width / 2, -image.height / 2);
  ctx.drawImage(image, 0, 0);

  const croppedCanvas = document.createElement("canvas");
  const croppedCtx = croppedCanvas.getContext("2d");

  if (!croppedCtx) throw new Error("No 2d context");

  croppedCanvas.width = pixelCrop.width;
  croppedCanvas.height = pixelCrop.height;

  croppedCtx.drawImage(
    canvas,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height
  );

  return croppedCanvas.toDataURL("image/jpeg", 0.9);
};

export default function App() {
  const [grade, setGrade] = useState(GRADES[2]);
  const [rawImage, setRawImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState<number | undefined>(undefined);
  const [completedCrop, setCompletedCrop] = useState<Area | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setRawImage(reader.result as string);
        setIsCropping(true);
        setRotation(0);
        setZoom(1);
        setAspect(undefined);
        setResult(null);
        setStatus("idle");
      };
      reader.readAsDataURL(file);
    }
  };

  const onCropComplete = useCallback((_: Area, clippedAreaPixels: Area) => {
    setCompletedCrop(clippedAreaPixels);
  }, []);

  const handleApplyCrop = async () => {
    if (rawImage && completedCrop) {
      try {
        const cropped = await getCroppedImg(rawImage, completedCrop, rotation);
        setCroppedImage(cropped);
        setIsCropping(false);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const analyzeQuestion = async () => {
    if (!croppedImage) return;

    setStatus("loading");
    setError(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
      
      const prompt = `
        你是一个专业的教育专家。请分析这张包含错题的图片。
        年级：${grade}
        
        请完成以下任务：
        1. OCR 识别题目文本。
        2. 提取题目涉及的核心知识点。
        3. 提供详细的正确解答和分步解析。
        4. 生成 3 道针对该知识点的变式训练题（难度分别为：易、中、难），并附带解析。
        
        请严格按照以下 JSON 格式返回结果：
        {
          "ocrText": "题目文本内容",
          "knowledgePoints": ["知识点1", "知识点2"],
          "solution": "详细解答内容（支持 Markdown）",
          "similarQuestions": [
            {
              "difficulty": "简单",
              "question": "变式题1内容",
              "analysis": "变式题1解析"
            },
            {
              "difficulty": "中等",
              "question": "变式题2内容",
              "analysis": "变式题2解析"
            },
            {
              "difficulty": "困难",
              "question": "变式题3内容",
              "analysis": "变式题3解析"
            }
          ]
        }
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: croppedImage.split(",")[1],
                },
              },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ocrText: { type: Type.STRING },
              knowledgePoints: { type: Type.ARRAY, items: { type: Type.STRING } },
              solution: { type: Type.STRING },
              similarQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    difficulty: { type: Type.STRING },
                    question: { type: Type.STRING },
                    analysis: { type: Type.STRING },
                  },
                  required: ["difficulty", "question", "analysis"],
                },
              },
            },
            required: ["ocrText", "knowledgePoints", "solution", "similarQuestions"],
          },
        },
      });

      const data = JSON.parse(response.text || "{}");
      setResult(data);
      setStatus("success");
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (err: any) {
      console.error(err);
      setError(err.message || "解析失败，请重试");
      setStatus("error");
    }
  };

  const exportToWord = async () => {
    if (!result || !croppedImage) return;
    setIsExporting(true);

    try {
      const response = await fetch("/api/export-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...result, grade, image: croppedImage }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `错题解析_${grade}_${new Date().toLocaleDateString()}.docx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        throw new Error("导出失败");
      }
    } catch (err) {
      console.error(err);
      alert("导出 Word 失败，请稍后再试");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-indigo-200 shadow-lg">
              <BrainCircuit size={24} />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">有云错题姐</h1>
          </div>
          <div className="flex items-center gap-3">
            <select 
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Upload Section */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm mb-8">
          <div className="flex flex-col items-center justify-center">
            {!croppedImage ? (
              <div className="w-full space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <button 
                    onClick={() => cameraInputRef.current?.click()}
                    className="aspect-square border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group"
                  >
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                      <Camera size={24} />
                    </div>
                    <p className="font-medium text-slate-600 text-sm">拍照上传</p>
                  </button>
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-3 hover:border-indigo-400 hover:bg-indigo-50/30 transition-all group"
                  >
                    <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                      <Upload size={24} />
                    </div>
                    <p className="font-medium text-slate-600 text-sm">相册选择</p>
                  </button>
                </div>
                <p className="text-center text-xs text-slate-400">提示：裁剪时请尽量只保留题目文字部分，以获得最佳识别效果</p>
              </div>
            ) : (
              <div className="w-full relative group">
                <img 
                  src={croppedImage} 
                  alt="Cropped" 
                  className="w-full max-h-96 object-contain rounded-xl border border-slate-200"
                />
                <div className="absolute top-2 right-2 flex gap-2">
                  <button 
                    onClick={() => setIsCropping(true)}
                    className="bg-white/90 backdrop-blur-sm shadow-md p-2 rounded-full text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title="重新裁剪"
                  >
                    <CropIcon size={20} />
                  </button>
                  <button 
                    onClick={() => {
                      setCroppedImage(null);
                      setRawImage(null);
                      setResult(null);
                      setStatus("idle");
                    }}
                    className="bg-white/90 backdrop-blur-sm shadow-md p-2 rounded-full text-slate-600 hover:text-red-500 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>
            )}
            
            {/* Hidden Inputs */}
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              className="hidden" 
            />
            <input 
              type="file" 
              ref={cameraInputRef} 
              onChange={handleImageUpload} 
              accept="image/*" 
              capture="environment"
              className="hidden" 
            />

            {croppedImage && status !== "loading" && (
              <button 
                onClick={analyzeQuestion}
                className="mt-6 w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold shadow-lg shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <BrainCircuit size={20} />
                解析错题
              </button>
            )}
          </div>
        </section>

        {/* Loading State */}
        <AnimatePresence>
          {status === "loading" && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl border border-slate-200 p-12 shadow-sm flex flex-col items-center justify-center gap-6"
            >
              <div className="relative">
                <Loader2 size={48} className="text-indigo-600 animate-spin" />
                <div className="absolute inset-0 blur-xl bg-indigo-400/20 animate-pulse rounded-full"></div>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-bold text-slate-800">AI 正在深度解析中...</h3>
                <p className="text-slate-500 text-sm mt-1">正在进行 OCR 识别、知识点提取及变式题生成</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error State */}
        {status === "error" && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-center gap-3 text-red-700 mb-8">
            <AlertCircle size={20} />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Results Section */}
        {status === "success" && result && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-8"
          >
            {/* OCR Text */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-slate-800">
                <FileText size={20} className="text-indigo-600" />
                <h2 className="font-bold">题目原文</h2>
              </div>
              <div className="bg-slate-50 rounded-xl p-4 text-slate-600 text-sm leading-relaxed italic">
                {result.ocrText}
              </div>
            </div>

            {/* Knowledge Points */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-slate-800">
                <BookOpen size={20} className="text-indigo-600" />
                <h2 className="font-bold">考察知识点</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {result.knowledgePoints.map((kp, i) => (
                  <span key={i} className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-semibold rounded-full border border-indigo-100">
                    {kp}
                  </span>
                ))}
              </div>
            </div>

            {/* Solution */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-4 text-slate-800">
                <CheckCircle2 size={20} className="text-emerald-600" />
                <h2 className="font-bold">正确解答与分步解析</h2>
              </div>
              <div className="prose prose-slate max-w-none prose-sm prose-headings:text-slate-800 prose-strong:text-indigo-600">
                <Markdown>{result.solution}</Markdown>
              </div>
            </div>

            {/* Similar Questions */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-slate-800 px-2">
                <GraduationCap size={20} className="text-indigo-600" />
                <h2 className="font-bold">变式训练（举一反三）</h2>
              </div>
              <div className="grid grid-cols-1 gap-4">
                {result.similarQuestions.map((q, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm hover:border-indigo-200 transition-colors">
                    <div className="flex items-center justify-between mb-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        q.difficulty === "简单" ? "bg-emerald-100 text-emerald-700" :
                        q.difficulty === "中等" ? "bg-amber-100 text-amber-700" :
                        "bg-rose-100 text-rose-700"
                      )}>
                        {q.difficulty}
                      </span>
                      <span className="text-xs text-slate-400 font-medium">变式题 {i + 1}</span>
                    </div>
                    <div className="prose prose-slate max-w-none prose-sm mb-4">
                      <Markdown>{q.question}</Markdown>
                    </div>
                    <details className="group">
                      <summary className="list-none cursor-pointer flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors">
                        <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                        查看解析
                      </summary>
                      <div className="mt-3 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 leading-relaxed border-l-2 border-indigo-500">
                        <Markdown>{q.analysis}</Markdown>
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </div>

            {/* Export Button */}
            <div className="sticky bottom-6 flex justify-center">
              <button 
                onClick={exportToWord}
                disabled={isExporting}
                className="bg-slate-900 text-white px-8 py-4 rounded-2xl font-bold shadow-2xl flex items-center gap-3 hover:bg-slate-800 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Download size={20} />
                )}
                {isExporting ? "正在生成报告..." : "导出 Word 解析报告"}
              </button>
            </div>
          </motion.div>
        )}
      </main>

      {/* Crop Modal */}
      <AnimatePresence>
        {isCropping && rawImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black flex flex-col"
          >
            <div className="h-16 flex items-center justify-between px-4 text-white">
              <button onClick={() => setIsCropping(false)} className="p-2">
                <X size={24} />
              </button>
              <h2 className="font-bold">裁剪题目</h2>
              <button 
                onClick={handleApplyCrop}
                className="bg-indigo-600 px-4 py-1.5 rounded-lg font-bold text-sm"
              >
                完成
              </button>
            </div>
            <div className="flex-1 relative bg-slate-900">
              <Cropper
                image={rawImage}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={aspect}
                onCropChange={setCrop}
                onRotationChange={setRotation}
                onCropComplete={onCropComplete}
                onZoomChange={setZoom}
                minZoom={0.2}
                maxZoom={5}
                restrictPosition={false}
              />
            </div>
            <div className="bg-black/80 backdrop-blur-xl p-4 space-y-4">
              {/* Aspect Ratio Selector */}
              <div className="flex items-center justify-center gap-2 overflow-x-auto pb-2 no-scrollbar">
                {[
                  { label: "自由", value: undefined },
                  { label: "1:1", value: 1 },
                  { label: "4:3", value: 4/3 },
                  { label: "16:9", value: 16/9 },
                  { label: "3:4", value: 3/4 }
                ].map((opt, i) => (
                  <button
                    key={i}
                    onClick={() => setAspect(opt.value)}
                    className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-bold transition-all whitespace-nowrap",
                      aspect === opt.value 
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30" 
                        : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl mx-auto">
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 px-1">
                    <span>缩放</span>
                    <span>{zoom.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    value={zoom}
                    min={0.5}
                    max={3}
                    step={0.1}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-400 px-1">
                    <span>旋转</span>
                    <span>{rotation}°</span>
                  </div>
                  <input
                    type="range"
                    value={rotation}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(e) => setRotation(Number(e.target.value))}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                </div>
              </div>
              <p className="text-center text-[9px] text-slate-500">提示：双指缩放或滑动滑块，确保题目水平且清晰</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      <footer className="max-w-4xl mx-auto px-4 py-12 text-center text-slate-400 text-xs">
        <p>© 2024 有云错题姐 · AI 赋能高效学习</p>
      </footer>
    </div>
  );
}
