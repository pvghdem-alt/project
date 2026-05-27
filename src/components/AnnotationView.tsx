import React, { useRef, useState, useEffect, MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent, PointerEvent as ReactPointerEvent } from 'react';
import { UploadCloud, Save, RotateCcw, Trash2, PenTool, Eraser, Map, Loader2 } from 'lucide-react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import imageCompression from 'browser-image-compression';

interface Point { x: number; y: number; }
interface Line { color: string; width: number; points: Point[]; }

export default function AnnotationView({
  floorId,
  selectedSpace,
  projectMap,
  driveAccessToken,
  initiateGoogleOAuth,
  user,
  setNotification,
}: any) {
  const [lines, setLines] = useState<Line[]>([]);
  const [currentLine, setCurrentLine] = useState<Line | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [color, setColor] = useState('#ef4444');
  const [lineWidth, setLineWidth] = useState(3);
  const [mode, setMode] = useState<'draw' | 'erase'>('draw');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const annotationDocId = `${floorId}_${selectedSpace}`;

  // Load annotations
  useEffect(() => {
    let isMounted = true;
    const fetchAnnotations = async () => {
      try {
        const docRef = doc(db, 'space_annotations', annotationDocId);
        const snap = await getDoc(docRef);
        if (snap.exists() && isMounted) {
          setLines(snap.data().lines || []);
        } else if (isMounted) {
          setLines([]);
        }
      } catch (err) {
        console.error("Failed to load annotations:", err);
      }
    };
    if (floorId && selectedSpace) {
      setLines([]); // clear on space switch
      fetchAnnotations();
      // Delay redraw to ensure background image loads
      setTimeout(redrawCanvas, 500);
    }
    return () => { isMounted = false; };
  }, [floorId, selectedSpace]);

  // Redraw when lines change or resize
  useEffect(() => {
    redrawCanvas();
  }, [lines, currentLine, projectMap?.floorPlan2DUrl]);

  useEffect(() => {
    const handleResize = () => redrawCanvas();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [lines]);

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    
    // Set internal canvas resolution to match its displayed DOM size
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const allLines = currentLine ? [...lines, currentLine] : lines;
    
    for (const line of allLines) {
      if (line.points.length === 0) continue;
      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.width;
      
      const first = line.points[0];
      ctx.moveTo(first.x * canvas.width, first.y * canvas.height);
      for (let i = 1; i < line.points.length; i++) {
         const p = line.points[i];
         ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      }
      ctx.stroke();
    }
  };

  const getCoordinates = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x: x / canvas.width, y: y / canvas.height };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Only allow drawing with Primary touch/pen or left mouse click
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    
    const coord = getCoordinates(e);
    if (!coord) return;
    
    setCurrentLine({
       color: mode === 'erase' ? 'rgba(0,0,0,1)' : color,
       width: mode === 'erase' ? 20 : lineWidth,
       points: [coord]
    });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!currentLine) return;
    const coord = getCoordinates(e);
    if (!coord) return;
    setCurrentLine({
      ...currentLine,
      points: [...currentLine.points, coord]
    });
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!currentLine) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    
    if (mode === 'erase') {
       // if erase mode, we filter lines that intersect with currentLine
       handleErase(currentLine);
       setCurrentLine(null);
    } else {
       setLines([...lines, currentLine]);
       setCurrentLine(null);
       // Auto-save debounced? Let's just user explicitly save or auto save upon up
       autoSave([...lines, currentLine]);
    }
  };

  const handleErase = (eraseStroke: Line) => {
    // Check intersection
    // A simplified approach: roughly check bounds or point distances
    const newLines = lines.filter(line => !intersectLine(line, eraseStroke));
    setLines(newLines);
    autoSave(newLines);
  };

  const intersectLine = (l1: Line, l2: Line) => {
    // simple O(N*M) distance check
    if (l1.points.length === 0 || l2.points.length === 0) return false;
    for (const p1 of l1.points) {
      for (const p2 of l2.points) {
         const dx = p1.x - p2.x;
         const dy = p1.y - p2.y;
         // since x,y are ratios, we roughly check squared distance
         if (dx*dx + dy*dy < 0.001) {
            return true;
         }
      }
    }
    return false;
  };

  const autoSave = async (updatedLines: Line[]) => {
    if (!user) return;
    setIsSaving(true);
    try {
      const docRef = doc(db, 'space_annotations', annotationDocId);
      await setDoc(docRef, { lines: updatedLines, floorId, space: selectedSpace, updatedAt: Date.now() }, { merge: true });
    } catch(e) {
      console.warn("Auto save failed", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUndo = () => {
    if (lines.length === 0) return;
    const newLines = lines.slice(0, -1);
    setLines(newLines);
    autoSave(newLines);
  };

  const handleClear = () => {
    const confirmed = window.confirm("確定要清空所有註記嗎？");
    if (confirmed) {
      setLines([]);
      autoSave([]);
    }
  };

  const handleFloorPlanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !floorId || !projectMap) return;
    if (!user) {
        setNotification({ message: '請先登入', type: 'error' });
        return;
    }
    
    setIsUploading(true);
    try {
      // Compress
      const compressed = await imageCompression(file, {
        maxSizeMB: 0.8,
        maxWidthOrHeight: 1600,
        useWebWorker: true
      });
      // Convert to base64
      const reader = new FileReader();
      reader.onloadend = async () => {
         const url = reader.result as string;
         // Save to project_maps
         const mapRef = doc(db, 'maps', floorId);
         await updateDoc(mapRef, { floorPlan2DUrl: url });
         setNotification({ message: '平面圖上傳成功', type: 'success' });
         setIsUploading(false);
      };
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error(err);
      setNotification({ message: '照片處理失敗: ' + (err as any).message, type: 'error' });
      setIsUploading(false);
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4">
       <div className="flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
            <Map size={18} className="text-blue-500" /> 平面圖註記
          </h4>
          <div className="flex items-center gap-3">
             {isSaving && <span className="text-xs text-slate-400 flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 已儲存</span>}
             {projectMap?.floorPlan2DUrl && (
               <label className="flex items-center gap-2 px-3 py-1.5 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold transition-all cursor-pointer">
                 <UploadCloud size={14} />
                 更換底圖
                 <input type="file" accept="image/*" className="hidden" onChange={handleFloorPlanUpload} />
               </label>
             )}
          </div>
       </div>

       {!projectMap?.floorPlan2DUrl ? (
          <div className="flex-1 flex flex-col items-center justify-center p-20 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
             <Map size={64} className="text-slate-200 mb-6" />
             <h3 className="text-xl font-bold text-slate-800 mb-2">{floorId} 尚未上傳平面圖</h3>
             <p className="text-sm text-slate-500 text-center max-w-sm mb-6">
                上傳該樓層的底部平面圖後，您可以在圖面上使用畫筆為【{selectedSpace}】標註位置。此樓層的底圖只需上傳一次。
             </p>
             <label className="flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-md shadow-blue-500/20 transition-all cursor-pointer">
                {isUploading ? <Loader2 size={16} className="animate-spin" /> : <UploadCloud size={16} />}
                選擇圖片上傳
                <input type="file" accept="image/*" className="hidden" onChange={handleFloorPlanUpload} disabled={isUploading} />
             </label>
          </div>
       ) : (
          <div className="flex-1 flex flex-col min-h-0 bg-slate-50 rounded-3xl overflow-hidden border border-slate-200/60 shadow-inner">
             {/* Toolbar */}
             <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
                   <button 
                     onClick={() => setMode('draw')}
                     className={`p-2 rounded-md transition-colors ${mode === 'draw' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                     title="畫筆"
                   >
                     <PenTool size={18} />
                   </button>
                   <button 
                     onClick={() => setMode('erase')}
                     className={`p-2 rounded-md transition-colors ${mode === 'erase' ? 'bg-white shadow-sm text-red-600' : 'text-slate-500 hover:text-slate-700'}`}
                     title="橡皮擦"
                   >
                     <Eraser size={18} />
                   </button>
                   <div className="w-px h-6 bg-slate-200 mx-2" />
                   {/* Colors */}
                   <div className="flex gap-2 px-2">
                     {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#000000'].map(c => (
                        <button 
                          key={c}
                          onClick={() => { setMode('draw'); setColor(c); }}
                          className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c && mode === 'draw' ? 'scale-110 border-white shadow-md' : 'border-transparent'}`}
                          style={{ backgroundColor: c }}
                        />
                     ))}
                   </div>
                </div>
                
                <div className="flex items-center gap-2">
                   <button onClick={handleUndo} disabled={lines.length === 0} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg disabled:opacity-40 transition-colors" title="復原">
                      <RotateCcw size={18} />
                   </button>
                   <button onClick={handleClear} disabled={lines.length === 0} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-40 transition-colors" title="清除全部">
                      <Trash2 size={18} />
                   </button>
                </div>
             </div>
             
             {/* Canvas Container */}
             <div ref={containerRef} className="flex-1 relative bg-[#e5e5ea] overflow-hidden flex items-center justify-center select-none touch-none">
                <img 
                  ref={imageRef}
                  src={projectMap.floorPlan2DUrl}
                  alt={`${floorId} Floor Plan`}
                  className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                  onLoad={redrawCanvas}
                />
                <canvas 
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerOut={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  style={{ touchAction: 'none' }} // Prevent scrolling on mobile while drawing
                />
             </div>
          </div>
       )}
    </div>
  );
}
