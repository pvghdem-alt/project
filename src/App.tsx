/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  Building2, 
  ChevronRight, 
  MessageSquare, 
  FileText, 
  Layout, 
  ShieldAlert, 
  PlusCircle, 
  CheckCircle2, 
  Map as MapIcon,
  Search,
  ExternalLink,
  Save,
  Menu,
  X,
  User,
  Info,
  Send,
  Loader2,
  Sparkles,
  ClipboardList,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DESIGN_SPECS } from './constants';
import { askAiAssistant } from './geminiService';

type FloorKey = 'B3F' | 'B5F';

interface Note {
  id: string;
  floor: FloorKey;
  space: string;
  content: string;
  timestamp: string;
  status: 'pending' | 'confirmed';
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function App() {
  const [activeFloor, setActiveFloor] = useState<FloorKey>('B3F');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  
  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const floorData = DESIGN_SPECS[activeFloor];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleAddNote = () => {
    if (!newNote.trim() || !selectedSpace) return;
    const note: Note = {
      id: Date.now().toString(),
      floor: activeFloor,
      space: selectedSpace,
      content: newNote,
      timestamp: new Date().toLocaleString(),
      status: 'pending'
    };
    setNotes([note, ...notes]);
    setNewNote('');
  };

  const handleAiQuery = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatInput('');
    setIsAiLoading(true);

    const aiRes = await askAiAssistant(userMsg);
    setChatMessages(prev => [...prev, { role: 'assistant', content: aiRes }]);
    setIsAiLoading(false);
  };

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="flex h-screen bg-brand-bg font-sans text-slate-200 overflow-hidden">
      {/* Sidebar Navigation */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        className="glass-panel flex flex-col h-full z-30 transition-all duration-300"
      >
        <div className="p-6 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${!sidebarOpen && 'hidden'}`}>
            <div className="bg-teal-500 p-2 rounded-lg text-black">
              <Building2 size={24} />
            </div>
            <h1 className="font-light text-xl tracking-tight text-slate-100 uppercase">龍泉院區</h1>
          </div>
          <button onClick={toggleSidebar} className="p-2 hover:bg-white/5 rounded-lg text-slate-500">
            {sidebarOpen ? <Menu size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto">
          <NavItem 
            icon={<MapIcon size={20} />} 
            label="B3F 慢性病房討論" 
            active={activeFloor === 'B3F'} 
            onClick={() => setActiveFloor('B3F')}
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={<MapIcon size={20} />} 
            label="B5F 急性病房討論" 
            active={activeFloor === 'B5F'} 
            onClick={() => setActiveFloor('B5F')}
            collapsed={!sidebarOpen}
          />
          <div className="h-px bg-slate-800 my-4" />
          <NavItem 
            icon={<ClipboardList size={20} />} 
            label="討論查檢表" 
            active={selectedSpace === 'checklist'} 
            onClick={() => setSelectedSpace('checklist')}
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={<ShieldAlert size={20} />} 
            label="工程技術規範" 
            active={selectedSpace === 'specs'} 
            onClick={() => setSelectedSpace('specs')}
            collapsed={!sidebarOpen}
          />
          <NavItem 
            icon={<MessageSquare size={20} />} 
            label="會議紀錄彙整" 
            active={selectedSpace === 'notes'} 
            onClick={() => setSelectedSpace('notes')}
            collapsed={!sidebarOpen}
          />
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className={`flex items-center gap-3 p-3 rounded-xl bg-white/5 ${!sidebarOpen && 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold">
              <User size={16} />
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate text-slate-200">工程承辦人</p>
                <p className="text-[10px] text-teal-500/60 font-mono tracking-tighter uppercase">Discussion Mode</p>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header Bar */}
        <header className="h-16 border-b border-slate-800 bg-brand-bg/50 backdrop-blur-sm px-8 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-4">
            <h2 className="font-light text-lg tracking-tight text-slate-100">{activeFloor} 細部設計討論</h2>
            <div className="flex gap-2">
              <span className="status-pill px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-tighter">
                {floorData.type}
              </span>
              <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] font-bold rounded border border-emerald-500/20 uppercase tracking-tighter">
                {floorData.beds} BEDS
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 border border-slate-700 px-3 py-1.5 rounded hover:bg-white/10 transition-colors uppercase tracking-widest">
                <ExternalLink size={14} />
                圖面比對
             </button>
             <button className="flex items-center gap-2 text-xs text-black bg-teal-500 px-4 py-1.5 rounded hover:bg-teal-400 shadow-lg shadow-teal-500/20 active:scale-95 transition-all font-bold uppercase tracking-widest">
                <Save size={14} />
                完成會議紀錄
             </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Interactive Viewer */}
          <div className="flex-1 overflow-auto bg-brand-bg p-6 flex flex-col">
            <div className="glass-panel rounded-2xl overflow-hidden relative flex-1 flex flex-col">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center z-10 bg-slate-900/40">
                 <div className="flex bg-slate-800/50 p-1 rounded">
                    <button className="text-[10px] font-bold px-4 py-1.5 rounded bg-teal-500 text-black uppercase tracking-widest">配置圖</button>
                    <button className="text-[10px] font-bold px-4 py-1.5 rounded text-slate-400 hover:text-slate-200 uppercase tracking-widest">工程標示</button>
                 </div>
                 <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <Info size={12} /> Click map to open space detail
                 </div>
              </div>
              <div className="flex-1 relative overflow-auto p-8 flex items-center justify-center">
                <div className="relative w-full h-full opacity-90 hover:opacity-100 transition-opacity min-h-[500px]">
                  {floorData.viewerUrl ? (
                    <iframe 
                      src={floorData.viewerUrl}
                      className="w-full h-full border-0 rounded-lg min-h-[600px]"
                      title={`${activeFloor} 3D Floor Plan`}
                    />
                  ) : (
                    <img 
                      src={floorData.image} 
                      alt={`${activeFloor} Floor Plan`}
                      className="w-full h-auto object-contain cursor-crosshair transition-transform"
                      referrerPolicy="no-referrer"
                    />
                  )}
                  
                  {/* Hotspots for B3F */}
                  {activeFloor === 'B3F' && (
                    <div className={floorData.viewerUrl ? "pointer-events-none absolute inset-0" : ""}>
                      <div className={`absolute top-[35%] left-[45%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="護理站" onClick={() => setSelectedSpace('護理站')} />
                      </div>
                      <div className={`absolute top-[45%] left-[25%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="一般病房區域" onClick={() => setSelectedSpace('一般病房')} />
                      </div>
                      <div className={`absolute top-[55%] left-[55%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="日光室" onClick={() => setSelectedSpace('公共活動區')} />
                      </div>
                      <div className={`absolute top-[35%] left-[15%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="4人房" onClick={() => setSelectedSpace('一般病房')} />
                      </div>
                    </div>
                  )}

                  {/* Hotspots for B5F */}
                  {activeFloor === 'B5F' && (
                    <div className={floorData.viewerUrl ? "pointer-events-none absolute inset-0" : ""}>
                      <div className={`absolute top-[42%] left-[48%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="護理站 (B5)" onClick={() => setSelectedSpace('護理站')} />
                      </div>
                      <div className={`absolute top-[18%] left-[32%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="保護室" color="red" onClick={() => setSelectedSpace('保護室')} />
                      </div>
                      <div className={`absolute top-[35%] right-[28%] ${floorData.viewerUrl ? "pointer-events-auto" : ""}`}>
                        <Hotspot label="多功能教室" onClick={() => setSelectedSpace('公共活動區')} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Discussion Panel */}
          <aside className="w-[480px] border-l border-slate-800 bg-slate-900/30 flex flex-col shrink-0 overflow-hidden backdrop-blur-xl">
            {/* Panel Tabs */}
            <div className="flex bg-slate-900/50 border-b border-slate-800">
               <button 
                  onClick={() => setSelectedSpace(null)}
                  className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${!selectedSpace || selectedSpace === 'specs' || selectedSpace === 'notes' || selectedSpace === 'checklist' ? 'border-teal-500 text-teal-400 bg-white/5' : 'border-transparent text-slate-500'}`}
               >
                  規範與查檢
               </button>
               <button 
                  disabled={!selectedSpace}
                  className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest border-b-2 transition-all ${selectedSpace && selectedSpace !== 'specs' && selectedSpace !== 'notes' && selectedSpace !== 'checklist' ? 'border-teal-500 text-teal-400 bg-white/5' : 'border-transparent text-slate-500 disabled:opacity-30'}`}
               >
                  空間細部討論
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
              {selectedSpace === 'checklist' ? (
                <div className="space-y-6">
                   <h3 className="font-light text-2xl text-slate-100 tracking-tight">討論查檢表</h3>
                   <div className="space-y-4">
                      {["病房走廊扶手位置與高度", "浴廁防滑地磚選樣", "讀取燈控制面板位置", "日光室儲物櫃層板間距", "護理站藥櫃抽屜標示", "保護室軟墊拼接縫隙"].map((item, i) => (
                        <div key={i} className="flex items-center gap-4 p-4 rounded-xl glass-panel hover:bg-white/5 transition-all cursor-pointer group">
                           <div className="w-5 h-5 rounded border border-slate-700 group-hover:border-teal-500 transition-colors" />
                           <span className="text-sm font-medium text-slate-300">{item}</span>
                        </div>
                      ))}
                   </div>
                </div>
              ) : selectedSpace && selectedSpace !== 'specs' && selectedSpace !== 'notes' ? (
                <AnimatePresence mode="wait">
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center justify-between">
                       <h3 className="font-light text-2xl text-slate-100 tracking-tight">{selectedSpace} 討論紀錄</h3>
                       <button onClick={() => setSelectedSpace(null)} className="p-2 hover:bg-white/5 rounded-full text-slate-500"><X size={20} /></button>
                    </div>

                    {/* Requirements Alert */}
                    <div className="bg-teal-500/5 border border-teal-500/20 rounded-2xl p-5 space-y-3">
                       <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Spec Requirement</span>
                       <ul className="space-y-3">
                          {DESIGN_SPECS.keyPoints.find(k => k.title.includes(selectedSpace) || (selectedSpace === '一般病房' && k.title.includes('病房')) || (selectedSpace === '公共活動區' && k.title.includes('公共')) )?.points.map((p, i) => (
                            <li key={i} className="flex gap-3 text-sm text-slate-400 leading-relaxed font-light">
                               <CheckCircle2 size={14} className="text-teal-500 shrink-0 mt-1" />
                               <p>{p}</p>
                            </li>
                          )) || <p className="text-sm text-slate-500 italic">無特定規範，請討論一般設計細節</p>}
                       </ul>
                    </div>

                    {/* Feedback Form */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">護理長意見紀錄</label>
                        <span className="text-[10px] text-teal-500 font-bold hover:underline cursor-pointer flex items-center gap-1 transition-all"><Sparkles size={12} /> AI 語音轉文字</span>
                      </div>
                      <textarea 
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={`記錄意見回饋...`}
                        className="w-full h-40 p-5 bg-slate-900/50 border border-slate-700 rounded-xl text-sm text-slate-200 focus:border-teal-500/50 outline-none resize-none transition-all placeholder:text-slate-600"
                      />
                      <button 
                        onClick={handleAddNote}
                        disabled={!newNote.trim()}
                        className="w-full py-4 bg-teal-500 text-black rounded-lg font-bold shadow-lg shadow-teal-500/20 hover:bg-teal-400 disabled:opacity-50 transition-all active:scale-95 text-xs uppercase tracking-widest"
                      >
                        儲存討論進度
                      </button>
                    </div>

                    {/* Local History */}
                    <div className="space-y-4 pt-4 border-t border-slate-800">
                       <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">當前會議紀錄</h4>
                       {notes.filter(n => n.space === selectedSpace && n.floor === activeFloor).length === 0 ? (
                         <div className="text-center py-12 px-4 glass-panel border-dashed rounded-xl">
                            <MessageSquare size={32} className="mx-auto text-slate-800 mb-3" />
                            <p className="text-xs text-slate-600 italic">目前無紀錄</p>
                         </div>
                       ) : (
                         notes.filter(n => n.space === selectedSpace && n.floor === activeFloor).map(n => (
                           <NoteItem key={n.id} note={n} />
                         ))
                       )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              ) : selectedSpace === 'notes' ? (
                <div className="space-y-6">
                   <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                    <h3 className="font-light text-2xl text-slate-100 tracking-tight">會議紀錄彙整</h3>
                    <button className="text-teal-500 hover:bg-white/5 p-2 rounded transition-colors"><RotateCcw size={18} /></button>
                   </div>
                   {notes.length === 0 ? (
                     <p className="text-xs text-slate-600 text-center py-20 italic">尚未有任何結論，請開始討論</p>
                   ) : (
                     notes.map(n => (
                        <NoteItem key={n.id} note={n} showLabel />
                     ))
                   )}
                </div>
              ) : (
                <div className="space-y-8 pb-12">
                   <div className="space-y-1">
                    <h3 className="font-light text-2xl text-slate-100 tracking-tight">改建工程重點</h3>
                    <p className="text-[10px] text-slate-600 uppercase tracking-widest">Construction Specifications</p>
                   </div>
                  {DESIGN_SPECS.keyPoints.map((section, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="p-6 glass-panel rounded-xl hover:bg-white/5 transition-all"
                    >
                       <h4 className="text-xs font-bold text-teal-400 mb-4 flex items-center gap-3 uppercase tracking-wider">
                         <span className="w-1.5 h-4 bg-teal-500 rounded-full" />
                         {section.title}
                       </h4>
                       <ul className="space-y-4">
                         {section.points.map((p, i) => (
                           <li key={i} className="text-xs text-slate-400 leading-relaxed flex gap-4 font-light">
                             <div className="w-4 h-4 text-teal-500 mt-0.5 shrink-0">
                                <FileText size={12} />
                             </div>
                             {p}
                           </li>
                         ))}
                       </ul>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Assistant Hook */}
            <div className="p-6 bg-slate-900/50 border-t border-slate-800 shrink-0 z-10">
               <div className="mb-4 space-y-3 max-h-[250px] overflow-y-auto pr-2 custom-scrollbar">
                 {chatMessages.length === 0 && (
                   <div className="flex gap-2">
                      <div className="bg-slate-800/80 text-slate-400 p-3 rounded-xl rounded-tl-none text-xs leading-relaxed max-w-[85%] border border-slate-700 font-light">
                        您好！我是設計助理。您可以問我關於醫療規範或特定空間設計要求的問題。
                      </div>
                   </div>
                 )}
                 {chatMessages.map((msg, i) => (
                   <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                     <div className={`p-3 rounded-xl text-xs leading-relaxed max-w-[85%] shadow-sm ${
                        msg.role === 'user' 
                          ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-tr-none' 
                          : 'bg-slate-800/80 text-slate-300 border border-slate-700 rounded-tl-none font-light'
                     }`}>
                        {msg.content}
                     </div>
                   </div>
                 ))}
                 <div ref={chatEndRef} />
               </div>
               
               <div className="flex gap-2 relative">
                  <input 
                    type="text" 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAiQuery()}
                    placeholder="查詢工程規範..." 
                    className="flex-1 bg-slate-900/80 text-slate-200 border border-slate-800 rounded px-5 py-3 text-xs outline-none focus:border-teal-500/30 pr-12 transition-all placeholder:text-slate-600 font-light" 
                  />
                  <button 
                    disabled={isAiLoading || !chatInput.trim()}
                    onClick={handleAiQuery}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-teal-500 p-2 rounded hover:bg-white/5 disabled:opacity-30 transition-all"
                  >
                    {isAiLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  </button>
               </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, collapsed }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, collapsed: boolean }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 group ${
        active 
          ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20 active-tab' 
          : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
      } ${collapsed && 'justify-center'}`}
    >
      <span className={`${active ? 'text-teal-500' : 'text-slate-600 group-hover:text-teal-400'} transition-colors`}>{icon}</span>
      {!collapsed && <span className="truncate text-[11px] font-medium uppercase tracking-wider">{label}</span>}
    </button>
  );
}

function Hotspot({ label, color = "blue", onClick }: { label: string, color?: string, onClick: () => void }) {
  const colorClass = color === "blue" ? "bg-teal-500 text-black box-shadow-teal" : "bg-red-500 text-white shadow-red-500/30";

  return (
    <button 
      onClick={onClick}
      className={`relative flex items-center justify-center group active:scale-90 transition-all z-10`}
    >
      <span className={`absolute flex h-10 w-10 items-center justify-center rounded-full ${color === "blue" ? "bg-teal-500" : "bg-red-500"} opacity-20 animate-ping`} />
      <span className={`relative w-8 h-8 rounded-full ${colorClass} border-4 border-slate-900 shadow-2xl flex items-center justify-center scale-100 group-hover:scale-110 transition-transform`}>
         <Layout size={12} />
      </span>
      
      <div className={`absolute bottom-full mb-3 left-1/2 -translate-x-1/2 p-0.5 rounded bg-slate-900 border border-slate-800 shadow-2xl opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 whitespace-nowrap z-[100]`}>
        <div className={`px-3 py-1.5 rounded text-[10px] font-bold tracking-widest uppercase ${color === 'blue' ? 'text-teal-400' : 'text-red-400'}`}>
           {label}
        </div>
      </div>
    </button>
  );
}

function NoteItem({ note, showLabel = false }: { note: Note, showLabel?: boolean }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 glass-panel rounded-xl hover:bg-white/5 transition-all group border-l-2 border-l-teal-500/50"
    >
      <div className="flex justify-between items-start mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{note.timestamp}</span>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <button className="text-teal-500/60 hover:text-teal-400 p-1"><CheckCircle2 size={12} /></button>
           <button className="text-slate-600 hover:text-red-500 p-1"><X size={12} /></button>
        </div>
      </div>
      {showLabel && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-500/10 text-teal-400 text-[9px] font-bold rounded mb-3 tracking-widest uppercase border border-teal-500/20">
          {note.floor} • {note.space}
        </span>
      )}
      <p className="text-xs text-slate-300 leading-relaxed font-light italic tracking-wide">「{note.content}」</p>
    </motion.div>
  );
}
