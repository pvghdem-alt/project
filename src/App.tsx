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
  User as UserIcon,
  Info,
  Send,
  Loader2,
  Sparkles,
  ClipboardList,
  RotateCcw,
  Key,
  Plus,
  LogIn,
  LogOut
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { DESIGN_SPECS } from './constants';
import { askAiAssistant, setCustomApiKey } from './geminiService';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  serverTimestamp,
  type Timestamp
} from 'firebase/firestore';
import { onAuthStateChanged, type User } from 'firebase/auth';

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
  
  // Custom Topics
  const [customTopics, setCustomTopics] = useState<string[]>(['護理站', '一般病房', '保護室', '公共活動區']);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const floorData = DESIGN_SPECS[activeFloor];

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Notes
  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    const q = query(collection(db, 'notes'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Note[];
      setNotes(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Firestore Sync: Topics
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'topics'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data().name);
      const defaultTopics = ['護理站', '一般病房', '保護室', '公共活動區'];
      setCustomTopics([...defaultTopics, ...data]);
    });
    return () => unsubscribe();
  }, [user]);

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedSpace || !user) return;
    const noteData = {
      floor: activeFloor,
      space: selectedSpace,
      content: newNote,
      timestamp: new Date().toLocaleString(), // Keep local string for UI but could use serverTimestamp
      status: 'pending',
      authorId: user.uid
    };
    try {
      await addDoc(collection(db, 'notes'), noteData);
      setNewNote('');
    } catch (err) {
      console.error("Error adding note:", err);
    }
  };

  const handleToggleNoteStatus = async (id: string, currentStatus: string) => {
    try {
      const noteRef = doc(db, 'notes', id);
      await updateDoc(noteRef, { status: currentStatus === 'confirmed' ? 'pending' : 'confirmed' });
    } catch (err) {
      console.error("Error updating note:", err);
    }
  };

  const handleDeleteNote = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'notes', id));
    } catch (err) {
      console.error("Error deleting note:", err);
    }
  };

  const handleAddTopic = async () => {
    if (newTopicName.trim() && !customTopics.includes(newTopicName.trim()) && user) {
      try {
        await addDoc(collection(db, 'topics'), {
          name: newTopicName.trim(),
          createdAt: serverTimestamp(),
          creatorId: user.uid
        });
        setNewTopicName('');
        setShowAddTopic(false);
      } catch (err) {
        console.error("Error adding topic:", err);
      }
    }
  };

  const handleSetApiKey = () => {
    if (apiKey.trim()) {
      setCustomApiKey(apiKey.trim());
      setIsApiKeySet(true);
      setShowApiModal(false);
    }
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

        <div className="p-4 border-t border-slate-800 space-y-4">
          <button 
            onClick={() => setShowApiModal(true)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${isApiKeySet ? 'bg-teal-500/10 text-teal-400 border border-teal-500/30' : 'bg-white/5 text-slate-400 border border-transparent hover:bg-white/10'} ${!sidebarOpen && 'justify-center'}`}
          >
            <Key size={18} />
            {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">{isApiKeySet ? 'API Key 已設定' : '設定 API Key'}</span>}
          </button>
          
          <div className="flex flex-col gap-2">
            {!user ? (
              <button 
                onClick={() => loginWithGoogle()}
                className={`w-full flex items-center gap-3 p-3 rounded-xl bg-teal-500 text-black font-bold transition-all hover:bg-teal-400 ${!sidebarOpen && 'justify-center'}`}
              >
                <LogIn size={18} />
                {sidebarOpen && <span className="text-xs uppercase tracking-widest">登入儲存</span>}
              </button>
            ) : (
              <div className={`p-3 rounded-xl bg-white/5 space-y-3 ${!sidebarOpen && 'flex justify-center'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold overflow-hidden">
                    {user.photoURL ? <img src={user.photoURL} alt="User" /> : <UserIcon size={16} />}
                  </div>
                  {sidebarOpen && (
                    <div className="overflow-hidden">
                      <p className="text-sm font-medium truncate text-slate-200">{user.displayName || '使用者'}</p>
                      <p className="text-[10px] text-teal-500/60 font-mono tracking-tighter uppercase">Cloud Synced</p>
                    </div>
                  )}
                </div>
                {sidebarOpen && (
                  <button 
                    onClick={() => logout()}
                    className="w-full flex items-center justify-center gap-2 py-1.5 text-[10px] text-slate-500 hover:text-red-400 hover:bg-red-500/5 rounded border border-transparent transition-all"
                  >
                    <LogOut size={12} /> 登出帳號
                  </button>
                )}
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
          <div className="flex-1 overflow-auto bg-brand-bg p-6 flex flex-col gap-6">
            <div className="glass-panel rounded-2xl overflow-hidden relative flex-[2] flex flex-col">
              <div className="p-4 border-b border-slate-800 flex justify-between items-center z-10 bg-slate-900/40">
                 <div className="flex bg-slate-800/50 p-1 rounded">
                    <button className="text-[10px] font-bold px-4 py-1.5 rounded bg-teal-500 text-black uppercase tracking-widest">配置圖</button>
                    <button className="text-[10px] font-bold px-4 py-1.5 rounded text-slate-400 hover:text-slate-200 uppercase tracking-widest">工程標示</button>
                 </div>
                 <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <Info size={12} /> 圖面檢視
                 </div>
              </div>
              <div className="flex-1 relative overflow-auto p-4 flex items-center justify-center">
                <div className="relative w-full h-full opacity-90 transition-opacity">
                  {floorData.viewerUrl ? (
                    <iframe 
                      src={floorData.viewerUrl}
                      className="w-full h-full border-0 rounded-lg"
                      title={`${activeFloor} 3D Floor Plan`}
                    />
                  ) : (
                    <img 
                      src={floorData.image} 
                      alt={`${activeFloor} Floor Plan`}
                      className="w-full h-auto object-contain transition-transform"
                      referrerPolicy="no-referrer"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Topic List */}
            <div className="flex-1 glass-panel rounded-2xl p-6 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">討論事項列表</h3>
                <button 
                  onClick={() => setShowAddTopic(!showAddTopic)}
                  className="p-1.5 hover:bg-white/5 rounded text-teal-500 transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>

              {showAddTopic && (
                <div className="mb-4 flex gap-2">
                  <input 
                    type="text"
                    value={newTopicName}
                    onChange={(e) => setNewTopicName(e.target.value)}
                    placeholder="輸入新空間名稱..."
                    className="flex-1 bg-slate-900/50 border border-slate-700 rounded px-3 py-1.5 text-xs outline-none focus:border-teal-500/50"
                  />
                  <button 
                    onClick={handleAddTopic}
                    className="bg-teal-500 text-black px-3 py-1.5 rounded text-xs font-bold"
                  >
                    新增
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 overflow-y-auto">
                {customTopics.map((topic, i) => (
                  <button 
                    key={i}
                    onClick={() => setSelectedSpace(topic)}
                    className={`flex items-center gap-3 p-4 rounded-xl border transition-all ${selectedSpace === topic ? 'bg-teal-500/10 border-teal-500 text-teal-400' : 'glass-panel hover:bg-white/5 border-transparent text-slate-400'}`}
                  >
                    <div className={`p-2 rounded-lg ${selectedSpace === topic ? 'bg-teal-500 text-black' : 'bg-white/5'}`}>
                      <Layout size={16} />
                    </div>
                    <span className="text-xs font-bold tracking-wider uppercase">{topic}</span>
                  </button>
                ))}
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
                        <NoteItem 
                          key={n.id} 
                          note={n} 
                          showLabel 
                          onToggleStatus={handleToggleNoteStatus}
                          onDelete={handleDeleteNote}
                        />
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

      {/* API Key Modal */}
      <AnimatePresence>
        {showApiModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-panel rounded-2xl p-8 max-w-md w-full shadow-2xl relative"
            >
              <button 
                onClick={() => setShowApiModal(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-white"
              >
                <X size={20} />
              </button>
              
              <div className="flex flex-col items-center text-center space-y-4 mb-8">
                <div className="bg-teal-500/20 p-4 rounded-full text-teal-500">
                  <Key size={32} />
                </div>
                <h3 className="text-xl font-light text-slate-100 uppercase tracking-tight">設定專屬 API KEY</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  若您希望使用自定義的 Gemini API Key，請在此輸入。這將覆蓋系統預設的金鑰。金鑰將僅存在於本次瀏覽，不會持久存儲於伺服器。
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Gemini API Key</label>
                  <input 
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="在此貼上您的 API Key..."
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-sm text-teal-400 outline-none focus:border-teal-500 transition-all font-mono"
                  />
                </div>
                <button 
                  onClick={handleSetApiKey}
                  className="w-full py-4 bg-teal-500 text-black font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-teal-400 transition-all active:scale-95"
                >
                  確認並連結 AI
                </button>
                <p className="text-[10px] text-center text-slate-500">
                  尚未有金鑰？ <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-teal-500 hover:underline">前往 Google AI Studio 獲取</a>
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
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

function NoteItem({ note, showLabel = false, onToggleStatus, onDelete }: { note: Note, showLabel?: boolean, onToggleStatus: (id: string) => void, onDelete: (id: string) => void }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-4 glass-panel rounded-xl hover:bg-white/5 transition-all group border-l-2 ${note.status === 'confirmed' ? 'border-l-emerald-500' : 'border-l-teal-500/50'}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{note.timestamp}</span>
          {note.status === 'confirmed' && (
            <span className="text-[9px] font-black bg-emerald-500 text-black px-1.5 rounded uppercase tracking-tighter">Confirmed</span>
          )}
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <button 
            onClick={() => onToggleStatus(note.id)}
            className={`${note.status === 'confirmed' ? 'text-emerald-500' : 'text-slate-500 hover:text-emerald-400'} p-1`}
           >
            <CheckCircle2 size={12} />
           </button>
           <button 
            onClick={() => onDelete(note.id)}
            className="text-slate-600 hover:text-red-500 p-1"
           >
            <X size={12} />
           </button>
        </div>
      </div>
      {showLabel && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-teal-500/10 text-teal-400 text-[9px] font-bold rounded mb-3 tracking-widest uppercase border border-teal-500/20">
          {note.floor} • {note.space}
        </span>
      )}
      <p className={`text-xs leading-relaxed italic tracking-wide ${note.status === 'confirmed' ? 'text-slate-100 font-medium' : 'text-slate-300 font-light'}`}>
        「{note.content}」
      </p>
    </motion.div>
  );
}
