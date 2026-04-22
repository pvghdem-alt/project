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
  LogOut,
  Image as ImageIcon,
  FileUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Markdown from 'react-markdown';
import { DESIGN_SPECS } from './constants';
import { askAiAssistant, setCustomApiKey, analyzeNotesToRequirements, deduplicateData, analyzeFileToSpecs } from './geminiService';
import { db } from './lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  setDoc,
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

type FloorKey = string;

interface ProjectMap {
  id: string;
  name: string;
  viewerUrl: string;
  type: '3d' | 'image';
  order: number;
}

interface RequirementCategory {
  id: string;
  title: string;
  points: string[];
}

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

interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  order: number;
}

export default function App() {
  const [activeFloor, setActiveFloor] = useState<FloorKey>('B3F');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isListening, setIsListening] = useState(false);
  
  // Custom Topics
  const [customTopics, setCustomTopics] = useState<string[]>(['護理站', '一般病房', '保護室', '公共活動區']);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);
  const [showApiModal, setShowApiModal] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'ai' } | null>(null);

  // Dynamic Maps & Requirements
  const [projectMaps, setProjectMaps] = useState<ProjectMap[]>([]);
  const [requirements, setRequirements] = useState<RequirementCategory[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [showAddMapModal, setShowAddMapModal] = useState(false);
  const [editingReq, setEditingReq] = useState<{ id: string, title: string, points: string[] } | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddCheckModal, setShowAddCheckModal] = useState(false);
  const [newCheckText, setNewCheckText] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400);
  const [expandedReqIds, setExpandedReqIds] = useState<string[]>([]);
  const [collapsedChatIndices, setCollapsedChatIndices] = useState<number[]>([]);
  const [isResizing, setIsResizing] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initializing active floor if data exists
  useEffect(() => {
    if (projectMaps.length > 0 && !projectMaps.find(m => m.id === activeFloor)) {
      setActiveFloor(projectMaps[0].id);
    }
  }, [projectMaps]);

  const activeMap = projectMaps.find(m => m.id === activeFloor) || (activeFloor === 'B3F' ? { name: 'B3F 慢性病房', viewerUrl: DESIGN_SPECS.B3F.viewerUrl, type: '3d' } : { name: 'B5F 急性病房', viewerUrl: DESIGN_SPECS.B5F.viewerUrl, type: '3d' });

  // Firestore Sync: Maps
  useEffect(() => {
    const q = query(collection(db, 'maps'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ProjectMap[];
      if (data.length > 0) setProjectMaps(data);
      else {
        // Fallback or seed initial maps if empty
        setProjectMaps([
          { id: 'B3F', name: 'B3F 精神科慢性病房', viewerUrl: DESIGN_SPECS.B3F.viewerUrl, type: '3d', order: 1 },
          { id: 'B5F', name: 'B5F 精神科急性病房', viewerUrl: DESIGN_SPECS.B5F.viewerUrl, type: '3d', order: 2 }
        ]);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Requirements
  useEffect(() => {
    const q = collection(db, 'requirements');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as RequirementCategory[];
      if (data.length > 0) setRequirements(data);
      else setRequirements(DESIGN_SPECS.keyPoints.map((k, i) => ({ id: `default-${i}`, ...k })));
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Firestore Sync: Notes
  useEffect(() => {
    const q = query(collection(db, 'notes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Note[];
      setNotes(data);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Topics
  useEffect(() => {
    const q = query(collection(db, 'topics'), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data().name);
      const defaultTopics = ['護理站', '一般病房', '保護室', '公共活動區'];
      setCustomTopics([...defaultTopics, ...data]);
    });
    return () => unsubscribe();
  }, []);

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedSpace) return;
    const noteData = {
      floor: activeFloor,
      space: selectedSpace,
      content: newNote,
      timestamp: new Date().toLocaleString(),
      createdAt: serverTimestamp(),
      status: 'pending',
      authorId: 'public'
    };
    try {
      await addDoc(collection(db, 'notes'), noteData);
      setNewNote('');
      setNotification({ message: '會議紀錄已儲存成功！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error("Error adding note:", err);
    }
  };

  // Firestore Sync: Checklist
  useEffect(() => {
    const q = query(collection(db, 'checklist'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ChecklistItem[];
      if (data.length > 0) setChecklist(data);
      else {
        // Seed initial checklist
        const initials = ["病房走廊扶手位置與高度", "浴廁防滑地磚選樣", "讀取燈控制面板位置", "日光室儲物櫃層板間距", "護理站藥櫃抽屜標示", "保護室軟墊拼接縫隙"];
        initials.forEach((text, i) => {
          addDoc(collection(db, 'checklist'), { text, checked: false, order: i, createdAt: serverTimestamp() });
        });
      }
    });
    return () => unsubscribe();
  }, []);

  const handleUpdateRequirement = async () => {
    if (!editingReq) return;
    try {
      if (editingReq.id.startsWith('default-')) {
        // Create new doc since it was just local fallback
        await addDoc(collection(db, 'requirements'), {
          title: editingReq.title,
          points: editingReq.points,
          updatedAt: serverTimestamp()
        });
      } else {
        await updateDoc(doc(db, 'requirements', editingReq.id), {
          title: editingReq.title,
          points: editingReq.points,
          updatedAt: serverTimestamp()
        });
      }
      setEditingReq(null);
      setNotification({ message: '內容已更新成功！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const handleToggleCheck = async (item: ChecklistItem) => {
    try {
      await updateDoc(doc(db, 'checklist', item.id), { checked: !item.checked });
    } catch (err) {
      console.error("Toggle check failed:", err);
    }
  };

  const handleDeleteCheck = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'checklist', id));
    } catch (err) {
      console.error("Delete check failed:", err);
    }
  };

  const handleAddCheck = async () => {
    if (!newCheckText.trim()) return;
    try {
      await addDoc(collection(db, 'checklist'), {
        text: newCheckText,
        checked: false,
        order: checklist.length,
        createdAt: serverTimestamp()
      });
      setNewCheckText('');
      setShowAddCheckModal(false);
    } catch (err) {
      console.error("Add check failed:", err);
    }
  };

  const handleAiCleanup = async (type: 'requirements' | 'checklist') => {
    setIsCleaning(true);
    setNotification({ message: 'AI 正在彙整重複內容中...', type: 'ai' });
    
    try {
      const sourceData = type === 'requirements' ? requirements : checklist;
      const cleanedData = await deduplicateData(type, sourceData);
      
      if (cleanedData && Array.isArray(cleanedData)) {
        const batch = writeBatch(db);
        
        if (type === 'requirements') {
          // Delete old
          requirements.forEach(r => {
            if (!r.id.startsWith('default-')) batch.delete(doc(db, 'requirements', r.id));
          });
          // Add new
          cleanedData.forEach(r => {
            const ref = doc(collection(db, 'requirements'));
            batch.set(ref, { ...r, updatedAt: serverTimestamp() });
          });
        } else {
          // Delete old
          checklist.forEach(c => batch.delete(doc(db, 'checklist', c.id)));
          // Add new
          cleanedData.forEach((c, i) => {
            const ref = doc(collection(db, 'checklist'));
            batch.set(ref, { ...c, order: i, createdAt: serverTimestamp() });
          });
        }
        
        await batch.commit();
        setNotification({ message: '重複內容已清理彙整完畢！', type: 'success' });
      }
    } catch (err) {
      console.error("Cleanup failed:", err);
      setNotification({ message: '清理失敗，請稍後再試。', type: 'success' }); // Use success theme for error but with error msg if needed
    } finally {
      setIsCleaning(false);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleAddMap = async () => {
    if (!newMapData.name || !newMapData.url) return;
    try {
      await addDoc(collection(db, 'maps'), {
        name: newMapData.name,
        viewerUrl: newMapData.url,
        type: newMapData.type,
        order: projectMaps.length + 1,
        createdAt: serverTimestamp()
      });
      setShowAddMapModal(false);
      setNewMapData({ name: '', url: '', type: 'image' });
    } catch (err) {
      console.error("Error adding map:", err);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsAiLoading(true);
    setNotification({ message: '正在分析文件內容並整合規範...', type: 'ai' });

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target?.result as string;
        const data = base64Data.split(',')[1];
        const mimeType = file.type;

        const analysis = await analyzeFileToSpecs({ data, mimeType });

        if (analysis) {
          const batch = writeBatch(db);
          
          if (analysis.requirements && Array.isArray(analysis.requirements)) {
            analysis.requirements.forEach((req: any) => {
              const ref = doc(collection(db, 'requirements'));
              batch.set(ref, { ...req, updatedAt: serverTimestamp() });
            });
          }

          if (analysis.checklist && Array.isArray(analysis.checklist)) {
            analysis.checklist.forEach((check: any, i: number) => {
              const ref = doc(collection(db, 'checklist'));
              batch.set(ref, { 
                text: check.text, 
                checked: false, 
                order: checklist.length + i, 
                createdAt: serverTimestamp() 
              });
            });
          }

          await batch.commit();
          setNotification({ message: '文件分析完成，規範已更新！', type: 'success' });
          
          setChatMessages(prev => [...prev, {
            role: 'assistant',
            content: `### 文件分析報告\n\n我已完成「${file.name}」的內容分析，並將相關條目整合進系統：\n\n- 新增了 ${analysis.requirements?.length || 0} 個規範類別\n- 新增了 ${analysis.checklist?.length || 0} 個查檢項目\n\n請前往對應頁面查看詳細內容。`
          }]);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error("File analysis failed:", err);
      setNotification({ message: '分析失敗，請重試。', type: 'success' });
    } finally {
      setIsAiLoading(false);
      setTimeout(() => setNotification(null), 3000);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAiSyncRequirements = async () => {
    if (notes.length === 0) {
      alert("目前尚無任何會議紀錄可供分析。");
      return;
    }
    
    setIsAnalyzing(true);
    try {
      // Use all confirmed notes for analysis. If no confirmed notes, use all notes.
      const sourceNotes = notes.filter(n => n.status === 'confirmed');
      const analysisInput = sourceNotes.length > 0 ? sourceNotes : notes;
      
      const updatedReqs = await analyzeNotesToRequirements(requirements, analysisInput);
      
      if (updatedReqs && Array.isArray(updatedReqs)) {
        const batch = writeBatch(db);
        
        // Update requirements in Firestore
        for (const req of updatedReqs) {
          // If title matches existing, update. Otherwise create new.
          const existing = requirements.find(r => r.title === req.title);
          if (existing) {
            batch.update(doc(db, 'requirements', existing.id), {
              points: req.points,
              updatedAt: serverTimestamp()
            });
          } else {
            const reqRef = doc(collection(db, 'requirements'));
            batch.set(reqRef, { ...req, updatedAt: serverTimestamp() });
          }
        }
        await batch.commit();
        setNotification({ message: 'AI 分析完成，工程規範已同步更新！', type: 'ai' });
        setTimeout(() => setNotification(null), 4000);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      alert("AI 分析失敗，請稍後再試。");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startVoiceToText = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("您的瀏覽器不支援語音辨識功能，請嘗試使用 Chrome 瀏覽器。");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const text = event.results[0][0].transcript;
      setNewNote(prev => prev + (prev ? ' ' : '') + text);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const handleToggleNoteStatus = async (id: string, currentStatus: string) => {
    try {
      const noteRef = doc(db, 'notes', id);
      await updateDoc(noteRef, { status: currentStatus === 'confirmed' ? 'pending' : 'confirmed' });
    } catch (err) {
      console.error("Error updating note:", err);
    }
  };

  const handleUpdateNote = async () => {
    if (!editingNote) return;
    try {
      await updateDoc(doc(db, 'notes', editingNote.id), {
        content: editingNote.content
      });
      setEditingNote(null);
      setNotification({ message: '會議紀錄已更新！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
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
    if (newTopicName.trim() && !customTopics.includes(newTopicName.trim())) {
      try {
        await addDoc(collection(db, 'topics'), {
          name: newTopicName.trim(),
          createdAt: serverTimestamp(),
          creatorId: 'public'
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

  const handleResize = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth > 300 && newWidth < 800) {
        setRightSidebarWidth(newWidth);
      }
    }
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', handleResize);
      window.addEventListener('mouseup', () => setIsResizing(false));
    }
    return () => {
      window.removeEventListener('mousemove', handleResize);
      window.removeEventListener('mouseup', () => setIsResizing(false));
    };
  }, [isResizing]);

  const toggleReqCollapse = (id: string) => {
    setExpandedReqIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleChatCollapse = (idx: number) => {
    setCollapsedChatIndices(prev => 
      prev.includes(idx) ? prev.filter(i => i !== idx) : [...prev, idx]
    );
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
          {projectMaps.map(map => (
            <NavItem 
              key={map.id}
              icon={<MapIcon size={20} />} 
              label={map.name} 
              active={activeFloor === map.id} 
              onClick={() => setActiveFloor(map.id)}
              collapsed={!sidebarOpen}
            />
          ))}
          
          <button 
            onClick={() => setShowAddMapModal(true)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl text-slate-500 hover:bg-white/5 hover:text-teal-400 transition-all border border-dashed border-slate-700 ${!sidebarOpen && 'justify-center'}`}
          >
            <Plus size={18} />
            {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">新增配置圖</span>}
          </button>

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
          
          <div className={`flex items-center gap-3 p-3 rounded-xl bg-white/5 ${!sidebarOpen && 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 font-bold overflow-hidden">
               <UserIcon size={16} />
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-sm font-medium truncate text-slate-200">工程協作模式</p>
                <p className="text-[10px] text-teal-500/60 font-mono tracking-tighter uppercase">Cloud Synced (Public)</p>
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
            <h2 className="font-light text-lg tracking-tight text-slate-100">{activeMap.name} 細部設計討論</h2>
            <div className="flex gap-2">
              <span className="status-pill px-2.5 py-1 text-[10px] font-bold rounded uppercase tracking-tighter">
                {activeMap.type === '3d' ? '3D Viewer' : '2D Image'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="flex items-center gap-2 text-xs text-slate-400 bg-white/5 border border-slate-700 px-3 py-1.5 rounded hover:bg-white/10 transition-colors uppercase tracking-widest">
                <ExternalLink size={14} />
                圖面比對
             </button>
             <button 
              onClick={handleAiSyncRequirements}
              disabled={isAnalyzing}
              className="flex items-center gap-2 text-xs text-black bg-teal-500 px-4 py-1.5 rounded hover:bg-teal-400 shadow-lg shadow-teal-500/20 active:scale-95 transition-all font-bold uppercase tracking-widest disabled:opacity-50"
             >
                {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isAnalyzing ? 'AI 分析中...' : '完成會議紀錄'}
             </button>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Interactive Viewer */}
          <div className="flex-1 overflow-auto bg-brand-bg p-6 flex flex-col gap-6">
            <AnimatePresence>
              {notification && (
                <motion.div 
                  initial={{ opacity: 0, y: -20, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: -20, x: '-50%' }}
                  className={`absolute top-20 left-1/2 px-6 py-2 rounded-full font-bold text-sm shadow-xl z-50 flex items-center gap-2 border ${
                    notification.type === 'ai' 
                      ? 'bg-purple-600 text-white border-purple-400' 
                      : 'bg-teal-500 text-black border-teal-400'
                  }`}
                >
                  {notification.type === 'ai' ? <Sparkles size={16} /> : <CheckCircle2 size={16} />}
                  {notification.message}
                </motion.div>
              )}
            </AnimatePresence>
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
                  {activeMap.type === '3d' ? (
                    <iframe 
                      src={activeMap.viewerUrl}
                      className="w-full h-full border-0 rounded-lg"
                      title={`${activeMap.name} 3D Floor Plan`}
                    />
                  ) : (
                    <img 
                      src={activeMap.viewerUrl} 
                      alt={activeMap.name}
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
          <div 
            onMouseDown={() => setIsResizing(true)}
            className="w-1 cursor-col-resize bg-slate-800 hover:bg-teal-500/50 transition-colors shrink-0 z-20"
          />
          <aside 
            style={{ width: rightSidebarWidth }}
            className="border-l border-slate-800 bg-slate-900/30 flex flex-col shrink-0 overflow-hidden backdrop-blur-xl transition-[width] duration-0"
          >
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
                   <div className="flex justify-between items-center bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
                    <div>
                      <h3 className="font-light text-2xl text-slate-100 tracking-tight">討論查檢表</h3>
                      <p className="text-[9px] text-slate-500 uppercase tracking-widest mt-1">Checklist deduplication available</p>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleAiCleanup('checklist')}
                        disabled={isCleaning || checklist.length === 0}
                        className="p-2.5 bg-purple-600/20 text-purple-400 rounded-xl hover:bg-purple-600/30 transition-all border border-purple-500/30 flex items-center gap-2 text-[10px] font-bold uppercase disabled:opacity-50"
                      >
                        {isCleaning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        彙整重複
                      </button>
                      <button 
                        onClick={() => setShowAddCheckModal(true)}
                        className="p-2.5 bg-teal-500/20 text-teal-400 rounded-xl hover:bg-teal-500/30 transition-all border border-teal-500/30"
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                   </div>
                   <div className="space-y-4">
                      {checklist.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-4 rounded-xl glass-panel hover:bg-white/5 transition-all group">
                           <div 
                             onClick={() => handleToggleCheck(item)}
                             className="flex items-center gap-4 flex-1 cursor-pointer"
                           >
                             <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${item.checked ? 'bg-teal-500 border-teal-500' : 'border-slate-700'}`}>
                               {item.checked && <CheckCircle2 size={12} className="text-black" />}
                             </div>
                             <span className={`text-sm font-medium ${item.checked ? 'text-slate-500 line-through' : 'text-slate-300'}`}>{item.text}</span>
                           </div>
                           <button 
                            onClick={() => handleDeleteCheck(item.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-600 hover:text-red-500 transition-opacity"
                           >
                             <X size={14} />
                           </button>
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
                          {requirements.find(k => k.title.includes(selectedSpace || '') || (selectedSpace === '一般病房' && k.title.includes('病房')) || (selectedSpace === '公共活動區' && k.title.includes('公共')) )?.points.map((p, i) => (
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
                        <button 
                          onClick={startVoiceToText}
                          className={`text-[10px] font-bold hover:underline cursor-pointer flex items-center gap-1 transition-all ${isListening ? 'text-red-500 animate-pulse' : 'text-teal-500'}`}
                        >
                          <Sparkles size={12} /> {isListening ? '收音中...' : 'AI 語音轉文字'}
                        </button>
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
                           <NoteItem 
                            key={n.id} 
                            note={n} 
                            onToggleStatus={handleToggleNoteStatus}
                            onDelete={handleDeleteNote}
                           onEdit={(note) => setEditingNote(note)}
                           />
                         ))
                       )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              ) : selectedSpace === 'notes' ? (
                <div className="space-y-6">
                   <div className="flex justify-between items-center border-b border-slate-800 pb-4">
                    <div>
                      <h3 className="font-light text-2xl text-slate-100 tracking-tight">會議紀錄彙整</h3>
                      <p className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">ALL DISCUSSION LOGS</p>
                    </div>
                    <div className="flex gap-2">
                       <button 
                        onClick={handleAiSyncRequirements}
                        disabled={isAnalyzing || notes.filter(n => n.status === 'confirmed').length === 0}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded-lg text-xs font-bold hover:bg-purple-500/20 transition-all disabled:opacity-30"
                       >
                         {isAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                         AI 分析並同步規範
                       </button>
                       <button className="text-teal-500 hover:bg-white/5 p-2 rounded transition-colors"><RotateCcw size={18} /></button>
                    </div>
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
                   <div className="flex justify-between items-center bg-slate-900/40 p-4 rounded-2xl border border-slate-800">
                    <div>
                      <h3 className="font-light text-2xl text-slate-100 tracking-tight">改建工程重點</h3>
                      <p className="text-[9px] text-slate-600 uppercase tracking-widest mt-1">Construction Specifications</p>
                    </div>
                    <button 
                      onClick={() => handleAiCleanup('requirements')}
                      disabled={isCleaning || requirements.length === 0}
                      className="p-2.5 bg-purple-600/20 text-purple-400 rounded-xl hover:bg-purple-600/30 transition-all border border-purple-500/30 flex items-center gap-2 text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                      {isCleaning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      彙整精簡規範
                    </button>
                   </div>
                   {requirements.map((section, idx) => {
                     const isExpanded = expandedReqIds.includes(section.id);
                     return (
                       <motion.div 
                         key={section.id}
                         initial={{ opacity: 0, y: 10 }}
                         animate={{ opacity: 1, y: 0 }}
                         transition={{ delay: idx * 0.05 }}
                         className="glass-panel rounded-xl overflow-hidden hover:bg-white/5 transition-all relative group"
                       >
                          <div 
                            onClick={() => toggleReqCollapse(section.id)}
                            className="p-5 flex items-center justify-between cursor-pointer"
                          >
                             <h4 className="text-xs font-bold text-teal-400 flex items-center gap-3 uppercase tracking-wider">
                               <span className="w-1.5 h-4 bg-teal-500 rounded-full" />
                               {section.title}
                             </h4>
                             <div className="flex items-center gap-3">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingReq({ id: section.id, title: section.title, points: [...section.points] });
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-2 text-teal-500 hover:bg-teal-500/10 rounded transition-all"
                                >
                                  <FileText size={14} />
                                </button>
                                <ChevronRight 
                                  size={16} 
                                  className={`text-slate-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`} 
                                />
                             </div>
                          </div>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="px-6 pb-6"
                              >
                                <ul className="space-y-4 pt-2 border-t border-slate-800/50">
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
                            )}
                          </AnimatePresence>
                       </motion.div>
                     );
                   })}
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
                 {chatMessages.map((msg, idx) => {
                   const isAssistant = msg.role === 'assistant';
                   const isCollapsed = collapsedChatIndices.includes(idx);
                   return (
                     <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                       <div className={`p-3 rounded-xl text-xs leading-relaxed max-w-[85%] shadow-sm relative group/msg ${
                          msg.role === 'user' 
                            ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20 rounded-tr-none' 
                            : 'bg-slate-800/80 text-slate-300 border border-slate-700 rounded-tl-none font-light prose prose-invert prose-xs shadow-none'
                       }`}>
                          {isAssistant && (
                            <button 
                              onClick={() => toggleChatCollapse(idx)}
                              className="absolute -top-2 -right-2 bg-slate-900 border border-slate-700 p-1 rounded-full text-slate-500 hover:text-teal-400 opacity-0 group-hover/msg:opacity-100 transition-opacity z-10"
                            >
                              {isCollapsed ? <Plus size={10} /> : <X size={10} />}
                            </button>
                          )}
                          {isAssistant ? (
                            isCollapsed ? (
                              <div className="flex items-center gap-2 text-slate-500 italic pb-1">
                                <Sparkles size={10} />
                                分析建議已收合...
                              </div>
                            ) : (
                              <div className="markdown-body">
                                <Markdown>{msg.content}</Markdown>
                              </div>
                            )
                          ) : msg.content}
                       </div>
                     </div>
                   );
                 })}
                 <div ref={chatEndRef} />
               </div>
               
               <div className="flex gap-2 relative items-center">
                  <input 
                    type="file" 
                    className="hidden" 
                    ref={fileInputRef} 
                    accept="image/*,.pdf,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2.5 text-slate-500 hover:text-teal-400 bg-slate-900/80 border border-slate-800 rounded transition-all"
                    title="上傳圖片或文件分析"
                  >
                    <FileUp size={16} />
                  </button>
                  <div className="flex-1 relative">
                    <input 
                      type="text" 
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => (e.key === 'Enter' && !e.shiftKey) && handleAiQuery()}
                      placeholder="查詢工程規範..." 
                      className="w-full bg-slate-900/80 text-slate-200 border border-slate-800 rounded px-5 py-3 text-xs outline-none focus:border-teal-500/30 pr-12 transition-all placeholder:text-slate-600 font-light" 
                    />
                    <button 
                      disabled={isAiLoading || !chatInput.trim()}
                      onClick={handleAiQuery}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-teal-500 p-2 rounded hover:bg-white/5 disabled:opacity-30 transition-all font-mono"
                    >
                      {isAiLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                  </div>
               </div>
            </div>
          </aside>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {editingReq && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingReq(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-xl font-light text-slate-100">編輯規範內容</h3>
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={editingReq.title}
                  onChange={(e) => setEditingReq({ ...editingReq, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 outline-none focus:border-teal-500"
                />
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">規範要點 (每行一個)</label>
                  <textarea 
                    value={editingReq.points.join('\n')}
                    onChange={(e) => setEditingReq({ ...editingReq, points: e.target.value.split('\n') })}
                    className="w-full h-64 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:border-teal-500 resize-none font-light leading-relaxed"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setEditingReq(null)} className="flex-1 py-4 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700">取消</button>
                 <button onClick={handleUpdateRequirement} className="flex-2 py-4 bg-teal-500 text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-teal-400">儲存變更</button>
              </div>
            </motion.div>
          </div>
        )}

        {editingNote && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingNote(null)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-xl font-light text-slate-100">編輯會議紀錄</h3>
              <div className="space-y-4">
                <textarea 
                  value={editingNote.content}
                  onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                  className="w-full h-48 bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-300 outline-none focus:border-teal-500 resize-none font-light leading-relaxed"
                />
              </div>
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setEditingNote(null)} className="flex-1 py-4 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700">取消</button>
                 <button onClick={handleUpdateNote} className="flex-2 py-4 bg-teal-500 text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-teal-400">儲存</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddCheckModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddCheckModal(false)} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-xl font-light text-slate-100">新增查檢項目</h3>
              <input 
                type="text" 
                value={newCheckText}
                onChange={(e) => setNewCheckText(e.target.value)}
                placeholder="例如：病房門色樣確認..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-slate-200 outline-none focus:border-teal-500"
              />
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setShowAddCheckModal(false)} className="flex-1 py-4 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700">取消</button>
                 <button onClick={handleAddCheck} className="flex-2 py-4 bg-teal-500 text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-teal-400">新增項目</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddMapModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddMapModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6"
            >
               <h3 className="text-xl font-light text-slate-100">新增配置圖/樓層</h3>
               <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">配置圖名稱</label>
                    <input 
                      type="text"
                      value={newMapData.name}
                      onChange={(e) => setNewMapData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="例如：B2F 護理空間..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:border-teal-500 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">圖面網址 (Image 或 3D URL)</label>
                    <input 
                      type="text"
                      value={newMapData.url}
                      onChange={(e) => setNewMapData(prev => ({ ...prev, url: e.target.value }))}
                      placeholder="https://..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-200 outline-none focus:border-teal-500 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">類型</label>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setNewMapData(prev => ({ ...prev, type: 'image' }))}
                        className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${newMapData.type === 'image' ? 'bg-teal-500 text-black' : 'bg-slate-950 text-slate-500 border border-slate-800'}`}
                       >2D 圖片</button>
                       <button 
                        onClick={() => setNewMapData(prev => ({ ...prev, type: '3d' }))}
                        className={`flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest transition-all ${newMapData.type === '3d' ? 'bg-teal-500 text-black' : 'bg-slate-950 text-slate-500 border border-slate-800'}`}
                       >3D 模型</button>
                    </div>
                  </div>
               </div>
               <div className="flex gap-3 pt-4">
                 <button 
                  onClick={() => setShowAddMapModal(false)}
                  className="flex-1 py-4 bg-slate-800 text-slate-300 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-700 transition-all"
                 >取消</button>
                 <button 
                  onClick={handleAddMap}
                  disabled={!newMapData.name || !newMapData.url}
                  className="flex-2 py-4 bg-teal-500 text-black rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-teal-400 disabled:opacity-50 transition-all"
                 >儲存圖面</button>
               </div>
            </motion.div>
          </div>
        )}

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
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="在此貼上您的 AIza... 開頭金鑰"
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

function NoteItem({ note, showLabel = false, onToggleStatus, onDelete, onEdit }: { note: Note, showLabel?: boolean, onToggleStatus: (id: string, current: string) => void, onDelete: (id: string) => void, onEdit: (note: Note) => void }) {
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
            onClick={() => onToggleStatus(note.id, note.status)}
            className={`${note.status === 'confirmed' ? 'text-emerald-500' : 'text-slate-500 hover:text-emerald-400'} p-1`}
            title="確認狀態"
           >
            <CheckCircle2 size={12} />
           </button>
           <button 
            onClick={() => onEdit(note)}
            className="text-slate-500 hover:text-teal-400 p-1"
            title="編輯內容"
           >
            <FileText size={12} />
           </button>
           <button 
            onClick={() => onDelete(note.id)}
            className="text-slate-600 hover:text-red-500 p-1"
            title="刪除紀錄"
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
