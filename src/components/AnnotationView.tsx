import React, { useRef, useState, useEffect, PointerEvent as ReactPointerEvent } from 'react';
import { UploadCloud, Save, RotateCcw, Trash2, PenTool, Eraser, Map, Loader2, Hand, Square } from 'lucide-react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import imageCompression from 'browser-image-compression';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface Point { x: number; y: number; pressure?: number; }
interface Line { color: string; width: number; points: Point[]; isRect?: boolean; }

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
  const [mode, setMode] = useState<'draw' | 'rect' | 'erase' | 'pan'>('draw');
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  
  const [showFloatingTools, setShowFloatingTools] = useState(false);
  const [floatingToolsPos, setFloatingToolsPos] = useState({ x: 0, y: 0 });

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
    if (!canvas) return;
    
    // We update canvas real resolution to match its CSS dimensions
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    
    if (cw === 0 || ch === 0) return;

    const targetWidth = Math.floor(cw * dpr);
    const targetHeight = Math.floor(ch * dpr);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    ctx.resetTransform();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cw, ch);
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const allLines = currentLine ? [...lines, currentLine] : lines;
    
    for (const line of allLines) {
      if (line.points.length === 0) continue;
      
      if (line.isRect) {
        if (line.points.length < 2) continue;
        const start = line.points[0];
        const end = line.points[line.points.length - 1];
        ctx.beginPath();
        ctx.strokeStyle = line.color;
        ctx.lineWidth = line.width;
        // Draw a clean rectangle outline
        ctx.strokeRect(
          start.x * cw,
          start.y * ch,
          (end.x - start.x) * cw,
          (end.y - start.y) * ch
        );
      } else {
        // Look for valid pressure events to decide if it's dynamic styling
        const hasPressure = line.points.some(p => p.pressure !== undefined && p.pressure > 0 && p.pressure !== 1 && p.pressure !== 0.5);
        
        if (hasPressure && line.points.length > 1) {
          // Dynamic stroke style based on stylus pressure
          for (let i = 1; i < line.points.length; i++) {
            const prev = line.points[i - 1];
            const curr = line.points[i];
            ctx.beginPath();
            ctx.moveTo(prev.x * cw, prev.y * ch);
            ctx.lineTo(curr.x * cw, curr.y * ch);
            
            ctx.strokeStyle = line.color;
            const p = curr.pressure !== undefined ? curr.pressure : 1;
            // Map stylus pressure to width variation (0.4x - 1.8x base stroke width)
            ctx.lineWidth = line.width * (0.4 + p * 1.4);
            ctx.stroke();
          }
        } else {
          // Fallback legacy fast rendering for standard touch or mouse inputs
          ctx.beginPath();
          ctx.strokeStyle = line.color;
          ctx.lineWidth = line.width;
          const first = line.points[0];
          ctx.moveTo(first.x * cw, first.y * ch);
          for (let i = 1; i < line.points.length; i++) {
             const p = line.points[i];
             ctx.lineTo(p.x * cw, p.y * ch);
          }
          ctx.stroke();
        }
      }
    }
  };

  const getCoordinates = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    return { x: x / rect.width, y: y / rect.height };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'pan') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (activePointerId !== null) return;
    
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActivePointerId(e.pointerId);
    
    const coord = getCoordinates(e);
    if (!coord) return;

    // Capture pen pressure if available
    const initialPoint = {
      ...coord,
      pressure: e.pointerType === 'pen' ? e.pressure : 1.0
    };
    
    setCurrentLine({
       color: mode === 'erase' ? 'rgba(0,0,0,1)' : color,
       width: mode === 'erase' ? 20 : lineWidth,
       points: [initialPoint],
       isRect: mode === 'rect'
    });
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'pan' || !currentLine || e.pointerId !== activePointerId) return;
    const coord = getCoordinates(e);
    if (!coord) return;

    const currentPoint = {
      ...coord,
      pressure: e.pointerType === 'pen' ? e.pressure : 1.0
    };
    
    if (mode === 'rect') {
      setCurrentLine({
        ...currentLine,
        points: [currentLine.points[0], currentPoint]
      });
    } else {
      setCurrentLine({
        ...currentLine,
        points: [...currentLine.points, currentPoint]
      });
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (mode === 'pan' || e.pointerId !== activePointerId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setActivePointerId(null);
    
    if (!currentLine) return;

    if (mode === 'erase') {
       handleErase(currentLine);
       setCurrentLine(null);
    } else {
       setLines(prev => {
         const newLines = [...prev, currentLine];
         autoSave(newLines);
         return newLines;
       });
       setCurrentLine(null);
    }
  };

  const handleErase = (eraseStroke: Line) => {
    const newLines = lines.filter(line => !intersectLine(line, eraseStroke));
    setLines(newLines);
    autoSave(newLines);
  };

  const intersectLine = (l1: Line, l2: Line) => {
    if (l1.points.length === 0 || l2.points.length === 0) return false;
    for (const p1 of l1.points) {
      for (const p2 of l2.points) {
         const dx = p1.x - p2.x;
         const dy = p1.y - p2.y;
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

  const getOrCreateAnnotationFolder = async (token: string) => {
    const rootName = "B棟3F、5F改建工程細部設計需求照片";
    const subName = "平面圖底圖";
    
    const findOrCreateFolder = async (name: string, parentId?: string) => {
      let queryStr = `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      if (parentId) {
        queryStr += ` and '${parentId}' in parents`;
      } else {
        queryStr += ` and 'root' in parents`;
      }
      
      const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(queryStr)}&fields=files(id,name)`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const searchData = await searchRes.json();
      if (searchData.files && searchData.files.length > 0) {
        return searchData.files[0].id;
      }
      
      const body: any = {
        name,
        mimeType: 'application/vnd.google-apps.folder'
      };
      if (parentId) {
        body.parents = [parentId];
      }
      
      const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });
      
      if (!createRes.ok) {
        const errText = await createRes.text();
        throw new Error(`建立資料夾 '${name}' 失敗: ${errText}`);
      }
      const data = await createRes.json();
      return data.id;
    };

    const rootId = await findOrCreateFolder(rootName);
    const subId = await findOrCreateFolder(subName, rootId);
    return subId;
  };

  const uploadFloorPlanToDrive = async (token: string, file: File) => {
    setIsUploading(true);
    setNotification({ message: '正在建立雲端硬碟平面圖目錄...', type: 'ai' });
    try {
      const folderId = await getOrCreateAnnotationFolder(token);
      
      const filename = `${floorId}_平面圖_${new Date().getTime()}.${file.name.split('.').pop() || 'png'}`;
      setNotification({ message: '正在上傳完整高畫質平面圖至 Google Drive...', type: 'ai' });

      // 1. Create file metadata
      const metaResponse = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: filename,
          mimeType: file.type,
          parents: [folderId]
        })
      });

      if (!metaResponse.ok) {
        const errText = await metaResponse.text();
        throw new Error(`建立雲端檔案紀錄失敗: ${errText}`);
      }

      const fileData = await metaResponse.json();
      const fileId = fileData.id;

      // 2. Upload raw file content (NO compression for maximum quality!)
      const mediaResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': file.type
        },
        body: file
      });

      if (!mediaResponse.ok) {
        const errText = await mediaResponse.text();
        throw new Error(`上傳照片內容失敗: ${errText}`);
      }

      // 3. Share permissions so anybody can read it
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
      } catch (permsErr) {
        console.warn("Could not share file permissions:", permsErr);
      }

      // Save high resolution cached thumbnail url from google drive (sz=w3000 provides pristine crisp layout)
      const publicUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w3000`;

      // 4. Update the map document in firestore
      const mapRef = doc(db, 'maps', floorId);
      await updateDoc(mapRef, { 
        floorPlan2DUrl: publicUrl,
        floorPlan2DDriveFileId: fileId 
      });

      setNotification({ message: '無損高畫質平面圖已成功上傳至雲端硬碟！', type: 'success' });
    } catch (err: any) {
      console.error(err);
      setNotification({ message: '平面圖上傳失敗: ' + (err.message || '未知錯誤'), type: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFloorPlanUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !floorId || !projectMap) return;
    if (!user) {
        setNotification({ message: '請先登入', type: 'error' });
        return;
    }
    
    if (!driveAccessToken) {
      setNotification({ message: '提示：底圖將無損上傳至雲端硬碟。正在引導 Google 帳號授權...', type: 'ai' });
      initiateGoogleOAuth((newToken: string) => {
        uploadFloorPlanToDrive(newToken, file);
      });
      return;
    }

    await uploadFloorPlanToDrive(driveAccessToken, file);
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
             {/* Floating Minimal Toolbar */}
             <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] bg-white/90 backdrop-blur-md border border-slate-200/60 flex flex-col md:flex-row shadow-xl rounded-2xl gap-2 w-[95%] md:w-auto p-2" style={{ pointerEvents: 'auto' }}>
                 <div className="flex flex-wrap items-center justify-between w-full gap-2">
                   <div className="flex flex-wrap items-center gap-1.5 bg-slate-100/80 p-1.5 rounded-xl">
                      <button 
                        onClick={() => setMode('draw')}
                        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'draw' ? 'bg-white shadow-md text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                        title="畫筆 (支援 Apple Pencil 壓感)"
                      >
                        <PenTool size={18} />
                        <span className="text-xs hidden sm:inline">畫筆</span>
                      </button>
                      <button 
                        onClick={() => setMode('rect')}
                        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'rect' ? 'bg-white shadow-md text-blue-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                        title="矩形標註框"
                      >
                        <Square size={18} />
                        <span className="text-xs hidden sm:inline">矩形</span>
                      </button>
                      <button 
                        onClick={() => setMode('erase')}
                        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'erase' ? 'bg-white shadow-md text-red-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                        title="橡皮擦"
                      >
                        <Eraser size={18} />
                        <span className="text-xs hidden sm:inline">橡皮擦</span>
                      </button>
                      <button 
                        onClick={() => setMode('pan')}
                        className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 ${mode === 'pan' ? 'bg-white shadow-md text-green-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                        title="移動位置與手勢縮放"
                      >
                        <Hand size={18} />
                        <span className="text-xs hidden sm:inline">移動</span>
                      </button>
                      
                      <div className="w-px h-6 bg-slate-300 mx-1 hidden sm:block" />
                      
                      {/* Colors */}
                      <div className="flex gap-1.5 px-1 items-center">
                        {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#000000'].map(c => (
                           <button 
                             key={c}
                             onClick={() => { 
                               if (mode !== 'rect' && mode !== 'draw') {
                                 setMode('draw'); 
                               }
                               setColor(c); 
                             }}
                             className={`w-5 h-5 rounded-full border-2 transition-transform ${(color === c && (mode === 'draw' || mode === 'rect')) ? 'scale-110 border-white shadow-md' : 'border-transparent'}`}
                             style={{ backgroundColor: c }}
                           />
                        ))}
                      </div>
                   </div>

                   {/* Actions & Size */}
                   <div className="flex items-center gap-2 justify-end px-2">
                      <div className="flex items-center gap-2 bg-slate-50/80 border border-slate-200/60 px-2 py-1.5 rounded-xl hidden sm:flex">
                         <span className="text-[10px] font-bold text-slate-500 whitespace-nowrap">粗細</span>
                         <input 
                           type="range" 
                           min="1" 
                           max="20" 
                           value={lineWidth} 
                           onChange={(e) => setLineWidth(Number(e.target.value))}
                           className="w-20 md:w-24 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                         />
                      </div>
                      <div className="flex items-center gap-1">
                         <button onClick={handleUndo} disabled={lines.length === 0} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50/50 rounded-lg disabled:opacity-40 transition-colors" title="復原">
                            <RotateCcw size={16} />
                         </button>
                         <button onClick={handleClear} disabled={lines.length === 0} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50/50 rounded-lg disabled:opacity-40 transition-colors" title="清除全部">
                            <Trash2 size={16} />
                         </button>
                      </div>
                   </div>
                 </div>
              </div>
             
             {/* Canvas Container */}
             <div className="flex-1 overflow-hidden bg-[#e5e5ea] relative">
                <TransformWrapper
                   panning={{ disabled: mode !== 'pan' }}
                   pinch={{ disabled: false, step: 2 }}
                   wheel={{ step: 0.02 }}
                   initialScale={1}
                   minScale={0.1}
                   maxScale={8}
                >
                   {({ zoomIn, zoomOut, resetTransform }) => (
                     <>
                     <TransformComponent wrapperClass="w-full h-full" contentClass="w-full h-full flex items-center justify-center">
                        <div className="relative shadow-lg" style={{ display: 'inline-block' }}>
                           <img 
                             ref={imageRef}
                             src={projectMap.floorPlan2DUrl}
                             alt={`${floorId} Floor Plan`}
                             className="pointer-events-none select-none block rounded-sm"
                             style={{ objectFit: 'contain', width: '100vw', minWidth: '1500px', maxWidth: 'none', maxHeight: 'none' }}
                             onLoad={() => {
                                // Wait a tick for layout to settle then redraw
                                setTimeout(redrawCanvas, 50);
                             }}
                           />
                           <canvas 
                             ref={canvasRef}
                             className={`absolute inset-0 w-full h-full touch-none ${mode === 'pan' ? 'pointer-events-none' : 'cursor-crosshair'}`}
                             onPointerDown={handlePointerDown}
                             onPointerMove={handlePointerMove}
                             onPointerUp={handlePointerUp}
                             onPointerOut={handlePointerUp}
                             onPointerCancel={handlePointerUp}
                             onContextMenu={(e) => {
                               e.preventDefault();
                               setShowFloatingTools(true);
                               setFloatingToolsPos({ x: e.clientX, y: e.clientY });
                             }}
                             style={{ touchAction: 'none' }}
                           />
                        </div>
                     </TransformComponent>
                     </>
                   )}
                </TransformWrapper>

                {/* Floating Apple Pencil Palette */}
                {showFloatingTools && (
                  <>
                    <div className="fixed inset-0 z-[100]" onClick={() => setShowFloatingTools(false)} onContextMenu={(e) => { e.preventDefault(); setShowFloatingTools(false); }} />
                    <div 
                      className="fixed z-[101] bg-slate-900/90 backdrop-blur-md p-2 rounded-2xl shadow-2xl border border-white/10 flex flex-col gap-2 transform -translate-x-1/2 -translate-y-1/2 transition-all animate-in zoom-in-90 duration-200"
                      style={{ left: floatingToolsPos.x, top: floatingToolsPos.y }}
                    >
                       <div className="flex gap-2">
                         <button onClick={() => { setMode('draw'); setShowFloatingTools(false); }} className={`p-3 rounded-xl transition-all ${mode === 'draw' ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><PenTool size={24} /></button>
                         <button onClick={() => { setMode('rect'); setShowFloatingTools(false); }} className={`p-3 rounded-xl transition-all ${mode === 'rect' ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Square size={24} /></button>
                         <button onClick={() => { setMode('erase'); setShowFloatingTools(false); }} className={`p-3 rounded-xl transition-all ${mode === 'erase' ? 'bg-red-500 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Eraser size={24} /></button>
                         <button onClick={() => { setMode('pan'); setShowFloatingTools(false); }} className={`p-3 rounded-xl transition-all ${mode === 'pan' ? 'bg-green-500 text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}><Hand size={24} /></button>
                       </div>
                       <div className="h-px w-full bg-white/10 my-1" />
                       <div className="flex justify-between px-2 gap-2">
                          {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#ffffff', '#000000'].map(c => (
                             <button 
                               key={c}
                               onClick={() => { 
                                 if (mode !== 'rect' && mode !== 'draw') setMode('draw');
                                 setColor(c); 
                                 setShowFloatingTools(false);
                               }}
                               className={`w-8 h-8 rounded-full border-2 transition-transform shadow-inner ${(color === c && (mode === 'draw' || mode === 'rect')) ? 'scale-110 border-white' : 'border-transparent'}`}
                               style={{ backgroundColor: c }}
                             />
                          ))}
                       </div>
                    </div>
                  </>
                )}
             </div>
          </div>
       )}
    </div>
  );
}
