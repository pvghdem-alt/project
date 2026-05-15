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

interface Topic {
  id: string;
  name: string;
  isDefault?: boolean;
  floorId?: string;
}

export default function App() {
  const [activeFloor, setActiveFloor] = useState<FloorKey>('B3F');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [newNote, setNewNote] = useState('');
  const [isListening, setIsListening] = useState(false);
  
  // Custom Topics
  const [customTopics, setCustomTopics] = useState<Topic[]>([
    { id: 'def-1', name: '護理站', isDefault: true },
    { id: 'def-2', name: '一般病房', isDefault: true },
    { id: 'def-3', name: '保護室', isDefault: true },
    { id: 'def-4', name: '公共活動區', isDefault: true }
  ]);
  const [showAddTopic, setShowAddTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');

  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [isApiKeySet, setIsApiKeySet] = useState(false);

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
      setApiKey(savedKey);
      setCustomApiKey(savedKey);
      setIsApiKeySet(true);
    }
  }, []);
  const [showApiModal, setShowApiModal] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'ai' | 'error' } | null>(null);

  // Dynamic Maps & Requirements
  const [projectMaps, setProjectMaps] = useState<ProjectMap[]>([]);
  const [newMapData, setNewMapData] = useState<{name: string, url: string, type: 'image'|'3d'}>({ name: '', url: '', type: 'image' });
  const [requirements, setRequirements] = useState<RequirementCategory[]>([]);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [showAddMapModal, setShowAddMapModal] = useState(false);
  const [editingReq, setEditingReq] = useState<{ id: string, title: string, points: string[] } | null>(null);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [showAddCheckModal, setShowAddCheckModal] = useState(false);
  const [newCheckText, setNewCheckText] = useState('');
  const [isCleaning, setIsCleaning] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [topicEditName, setTopicEditName] = useState('');
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
      const defaults = DESIGN_SPECS.keyPoints.map((k, i) => ({ id: `default-${i}`, ...k }));
      if (data.length > 0) {
        const merged = [...data];
        defaults.forEach(def => {
          if (!data.some(d => d.title === def.title || (def.title.includes('保護室') && d.title.includes('保護室')) || (def.title.includes('護理') && d.title.includes('護理')) || (def.title.includes('病房') && d.title.includes('病房')))) {
             merged.push(def);
          }
        });
        setRequirements(merged);
      } else {
        setRequirements(defaults);
      }
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
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        isDefault: false
      })) as Topic[];
      const defaultTopics: Topic[] = [
        { id: 'def-1', name: '護理站', isDefault: true },
        { id: 'def-2', name: '一般病房', isDefault: true },
        { id: 'def-3', name: '保護室', isDefault: true },
        { id: 'def-4', name: '公共活動區', isDefault: true }
      ];
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
      status: 'confirmed',
      authorId: 'public'
    };
    try {
      await addDoc(collection(db, 'notes'), noteData);
      setNewNote('');
      setNotification({ message: '紀錄已儲存！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error("Error adding note:", err);
      setNotification({ message: '儲存發生錯誤', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const handleCompleteMeeting = async () => {
    if (!selectedSpace) return;
    setIsCleaning(true);
    setNotification({ message: 'AI 正在整合會議紀錄至工程規範...', type: 'ai' });
    try {
      const thisSpaceReqs = requirements.filter(r => r.title === selectedSpace || r.title.includes(selectedSpace));
      const sourceNotes = notes.filter(n => n.space === selectedSpace && n.floor === activeFloor);

      if (sourceNotes.length === 0) {
         setNotification({ message: '無會議紀錄可整合', type: 'error' });
         setIsCleaning(false);
         setTimeout(() => setNotification(null), 2000);
         return;
      }

      const updatedReqs = await analyzeNotesToRequirements(
        thisSpaceReqs.length ? thisSpaceReqs : [{ id: 'new', title: selectedSpace, points: [] }], 
        sourceNotes
      );
      
      if (updatedReqs && updatedReqs.length > 0) {
          const req = updatedReqs[0];
          const existing = requirements.find(r => r.title === req.title || r.title.includes(selectedSpace));
          if (existing && !existing.id.startsWith('default-')) {
            await updateDoc(doc(db, 'requirements', existing.id), {
              points: req.points,
              updatedAt: serverTimestamp()
            });
          } else {
            await addDoc(collection(db, 'requirements'), { ...req, title: existing ? existing.title : selectedSpace, updatedAt: serverTimestamp() });
          }
          setNotification({ message: '工程規範已自動彙整！', type: 'success' });
      } else {
          setNotification({ message: '無更新的規範', type: 'success' });
      }
    } catch (e) {
      console.error(e);
      setNotification({ message: '彙整失敗', type: 'error' });
    } finally {
      setIsCleaning(false);
      setTimeout(() => setNotification(null), 2000);
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

    // Check if API Key is set (either custom or system)
    // We can check if isApiKeySet is true, but that only tracks custom key.
    // However, analyzeFileToSpecs will try to initialize and throw if it fails.
    
    setIsAiLoading(true);
    setNotification({ message: '正在讀取文件，請稍候...', type: 'ai' });

    try {
      const readFileAsBase64 = (file: File): Promise<{data: string, mimeType: string}> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64Data = reader.result as string;
            const data = base64Data.split(',')[1];
            resolve({ data, mimeType: file.type });
          };
          reader.onerror = () => reject(new Error("文件讀取失敗"));
          reader.readAsDataURL(file);
        });
      };

      const fileData = await readFileAsBase64(file);
      setNotification({ message: `正在分析 ${file.name}...`, type: 'ai' });
      
      const analysis = await analyzeFileToSpecs(fileData);

      if (analysis) {
        const batch = writeBatch(db);
        let reqCount = 0;
        let checkCount = 0;
        
        if (analysis.requirements && Array.isArray(analysis.requirements)) {
          analysis.requirements.forEach((req: any) => {
            const ref = doc(collection(db, 'requirements'));
            batch.set(ref, { 
              ...req, 
              updatedAt: serverTimestamp(),
              source: `Imported from ${file.name}`
            });
            reqCount++;
          });
        }

        if (analysis.checklist && Array.isArray(analysis.checklist)) {
          analysis.checklist.forEach((check: any, i: number) => {
            const ref = doc(collection(db, 'checklist'));
            batch.set(ref, { 
              text: check.text, 
              checked: false, 
              order: checklist.length + i, 
              createdAt: serverTimestamp(),
              source: `Imported from ${file.name}`
            });
            checkCount++;
          });
        }

        await batch.commit();
        setNotification({ message: '文件分析完成，規範已更新！', type: 'success' });
        
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `### 📄 文件分析成功\n\n我已完成對 **${file.name}** 的深入分析。以下是匯入摘要：\n\n- **工程規範**：新增了 ${reqCount} 條條文\n- **查檢表**：新增了 ${checkCount} 個項目\n\n您可以點擊右側欄位的標籤頁查看細節。若有不準確之處，建議手動微調。`
        }]);
      } else {
        setNotification({ 
          message: '分析失敗。請確認：1. API Key 正確 2. 檔案內容清晰 3. 檔案類型支援 (PDF/圖片)', 
          type: 'error' 
        });
      }
    } catch (err: any) {
      console.error("File analysis failed:", err);
      const errorMsg = err.message || '分析過程發生未知錯誤';
      setNotification({ message: `錯誤: ${errorMsg}`, type: 'error' });
      
      // If error is related to API key, show modal
      if (errorMsg.includes("initialized") || errorMsg.includes("API Key")) {
        setShowApiModal(true);
      }
    } finally {
      setIsAiLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
      // Keep errors visible for longer
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
    if (newTopicName.trim() && !customTopics.some(t => t.name === newTopicName.trim())) {
      try {
        await addDoc(collection(db, 'topics'), {
          name: newTopicName.trim(),
          createdAt: serverTimestamp(),
          creatorId: 'public',
          floorId: activeFloor
        });
        setNewTopicName('');
        setShowAddTopic(false);
      } catch (err) {
        console.error("Error adding topic:", err);
      }
    }
  };

  const handleUpdateTopicName = async (topicId: string) => {
    if (!topicEditName.trim()) {
      setEditingTopicId(null);
      return;
    }
    try {
      await updateDoc(doc(db, 'topics', topicId), {
        name: topicEditName.trim()
      });
      setEditingTopicId(null);
      setTopicEditName('');
      setNotification({ message: '空間名稱已更新', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error("Error updating topic name:", err);
    }
  };

  const handleDeleteTopic = async (topic: Topic) => {
    if (topic.isDefault) {
      setNotification({ message: '系統預設空間無法刪除', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
      return;
    }
    
    if (!confirm(`確定要刪除「${topic.name}」及其相關討論紀錄嗎？`)) return;

    try {
      // Delete the topic record
      await deleteDoc(doc(db, 'topics', topic.id));
      
      // Also delete notes associated with this topic (optional but cleaner)
      const topicNotes = notes.filter(n => n.space === topic.name);
      const batch = writeBatch(db);
      topicNotes.forEach(n => {
        batch.delete(doc(db, 'notes', n.id));
      });
      await batch.commit();

      if (selectedSpace === topic.name) setSelectedSpace(null);
      setNotification({ message: `空間「${topic.name}」已刪除`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error("Error deleting topic:", err);
    }
  };

  const handleSetApiKey = () => {
    if (apiKey.trim()) {
      setCustomApiKey(apiKey.trim());
      localStorage.setItem('gemini_api_key', apiKey.trim());
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
    <div className="flex h-screen bg-brand-bg font-sans text-slate-900 overflow-hidden">
      {/* Sidebar Navigation */}
      <motion.aside 
        initial={false}
        animate={{ width: sidebarOpen ? 280 : 80 }}
        className="glass-panel flex flex-col h-full z-30 transition-all duration-300"
      >
        <div className="p-6 flex items-center justify-between">
          <div className={`flex items-center gap-3 ${!sidebarOpen && 'hidden'}`}>
            <div className="bg-blue-500 p-2 rounded-lg text-white">
              <Building2 size={24} />
            </div>
            <h1 className="font-light text-2xl tracking-tight text-slate-900 uppercase">龍泉院區</h1>
          </div>
          <button onClick={toggleSidebar} className="p-2 hover:bg-black/5 rounded-lg text-slate-500">
            {sidebarOpen ? <Menu size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto custom-scrollbar">
          <div className="mb-2">
             <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">空間總覽</h3>
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
               className={`w-full flex items-center gap-3 p-3 rounded-xl text-slate-500 hover:bg-black/5 hover:text-blue-600 transition-all border border-dashed border-slate-300 mt-2 ${!sidebarOpen && 'justify-center'}`}
             >
               <Plus size={18} />
               {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">新增配置圖</span>}
             </button>
          </div>

          <div className="h-px bg-slate-100 my-4" />
          
          <div className="mb-2">
             <div className="flex items-center justify-between px-4 mb-2">
                <h3 className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest ${!sidebarOpen && 'hidden'}`}>空間細部討論</h3>
                {sidebarOpen && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); setShowAddTopic(!showAddTopic); }}
                    className="p-1 hover:bg-black/5 rounded text-blue-500 transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                )}
             </div>

             {sidebarOpen && showAddTopic && (
               <div className="mb-4 flex gap-2 px-2">
                 <input 
                   type="text"
                   value={newTopicName}
                   onChange={(e) => setNewTopicName(e.target.value)}
                   placeholder="輸入新空間名稱..."
                   className="flex-1 bg-[#F2F2F7] border border-slate-300 rounded px-2 py-1.5 text-xs outline-none focus:border-blue-500/50"
                 />
                 <button 
                   onClick={handleAddTopic}
                   className="bg-blue-500 text-white px-2 py-1.5 rounded text-xs font-bold"
                 >
                   新增
                 </button>
               </div>
             )}

             {customTopics.filter(t => t.isDefault || t.floorId === activeFloor).map((topic) => (
               <NavItem 
                 key={topic.id}
                 icon={<Layout size={20} />} 
                 label={topic.name} 
                 active={selectedSpace === topic.name} 
                 onClick={() => setSelectedSpace(topic.name)}
                 collapsed={!sidebarOpen}
                 onDoubleClick={() => !topic.isDefault && (setEditingTopicId(topic.id), setTopicEditName(topic.name))}
                 isEditing={editingTopicId === topic.id}
                 editValue={topicEditName}
                 onEditChange={setTopicEditName}
                 onEditSubmit={() => handleUpdateTopicName(topic.id)}
                 onEditCancel={() => setEditingTopicId(null)}
                 onDelete={!topic.isDefault ? () => handleDeleteTopic(topic) : undefined}
               />
             ))}
          </div>
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-4">
          <button 
            onClick={() => setShowApiModal(true)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${isApiKeySet ? 'bg-blue-500/10 text-blue-600 border border-blue-500/30' : 'bg-black/5 text-slate-500 border border-transparent hover:bg-black/10'} ${!sidebarOpen && 'justify-center'}`}
          >
            <Key size={18} />
            {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">{isApiKeySet ? 'API Key 已設定' : '設定 API Key'}</span>}
          </button>
          
          <div className={`flex items-center gap-3 p-3 rounded-xl bg-black/5 ${!sidebarOpen && 'justify-center'}`}>
            <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-600 font-bold overflow-hidden">
               <UserIcon size={16} />
            </div>
            {sidebarOpen && (
              <div className="overflow-hidden">
                <p className="text-base font-medium truncate text-slate-900">工程協作模式</p>
                <p className="text-xs text-blue-500/60 font-mono tracking-tighter uppercase">Cloud Synced (Public)</p>
              </div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header Bar */}
        <header className="h-16 border-b border-slate-200 bg-brand-bg/50 backdrop-blur-sm px-8 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-4">
            <h2 className="font-light text-xl tracking-tight text-slate-900">{activeMap.name} 細部設計討論</h2>
            <div className="flex gap-2">
              <span className="status-pill px-2.5 py-1 text-xs font-bold rounded uppercase tracking-tighter">
                {activeMap.type === '3d' ? '3D Viewer' : '2D Image'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="flex items-center gap-2 text-sm text-slate-500 bg-black/5 border border-slate-300 px-3 py-1.5 rounded hover:bg-black/10 transition-colors uppercase tracking-widest">
                <ExternalLink size={14} />
                圖面比對
             </button>
             <button 
              onClick={handleAiSyncRequirements}
              disabled={isAnalyzing}
              className="flex items-center gap-2 text-sm text-white bg-blue-500 px-4 py-1.5 rounded hover:bg-blue-600 shadow-lg shadow-blue-500/20 active:scale-95 transition-all font-bold uppercase tracking-widest disabled:opacity-50"
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
                  className={`absolute top-20 left-1/2 px-6 py-2 rounded-full font-bold text-base shadow-xl z-50 flex items-center gap-2 border ${
                    notification.type === 'ai' 
                      ? 'bg-purple-600 text-white border-purple-400' 
                      : notification.type === 'error'
                        ? 'bg-red-600 text-white border-red-400'
                        : 'bg-blue-500 text-white border-blue-600'
                  }`}
                >
                  {notification.type === 'ai' ? <Sparkles size={16} /> : 
                   notification.type === 'error' ? <X size={16} /> : <CheckCircle2 size={16} />}
                  {notification.message}
                </motion.div>
              )}
            </AnimatePresence>
            <div className="glass-panel rounded-2xl overflow-hidden relative flex-[2] flex flex-col">
              <div className="p-4 border-b border-slate-200 flex justify-between items-center z-10 bg-white/40">
                 <div className="flex bg-slate-100/50 p-1 rounded">
                    <button className="text-xs font-bold px-4 py-1.5 rounded bg-blue-500 text-white uppercase tracking-widest">配置圖</button>
                    <button className="text-xs font-bold px-4 py-1.5 rounded text-slate-500 hover:text-slate-900 uppercase tracking-widest">工程標示</button>
                 </div>
                 <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
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
          </div>

          {/* Right: Discussion Panel */}
          <div 
            onMouseDown={() => setIsResizing(true)}
            className="w-1 cursor-col-resize bg-slate-100 hover:bg-blue-500/50 transition-colors shrink-0 z-20"
          />
          <aside 
            style={{ width: rightSidebarWidth }}
            className="border-l border-slate-200 bg-white/30 flex flex-col shrink-0 overflow-hidden backdrop-blur-xl transition-[width] duration-0"
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
              {!selectedSpace ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-sm">
                  請選擇一個空間進行細部討論
                </div>
              ) : (
                <AnimatePresence mode="wait">
                  <motion.div 
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="flex items-center justify-between">
                       <h3 className="font-light text-3xl text-slate-900 tracking-tight">{selectedSpace} 討論紀錄</h3>
                       <button onClick={() => setSelectedSpace(null)} className="p-2 hover:bg-black/5 rounded-full text-slate-500"><X size={20} /></button>
                    </div>

                    {/* Requirements Alert */}
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-5 space-y-3">
                       <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-blue-600 uppercase tracking-widest">Spec Requirement</span>
                       </div>
                       <ul className="space-y-3">
                          {requirements.find(k => k.title === selectedSpace || k.title.includes(selectedSpace || '') || (selectedSpace === '一般病房' && k.title.includes('病房')) || (selectedSpace === '公共活動區' && k.title.includes('公共')) )?.points.map((p, i) => {
                            // Extract category prefix if exists
                            const match = p.match(/^【(.*?)】(.*)/);
                            if (match) {
                               return (
                                 <li key={i} className="flex gap-3 text-base text-slate-700 leading-relaxed font-light">
                                    <div className="shrink-0 mt-1">
                                      <span className="text-xs font-bold bg-blue-500 text-white px-2 py-0.5 rounded uppercase">{match[1]}</span>
                                    </div>
                                    <p>{match[2].trim().replace(/^[:：]/, '').trim()}</p>
                                 </li>
                               );
                            }
                            return (
                               <li key={i} className="flex gap-3 text-base text-slate-500 leading-relaxed font-light">
                                  <CheckCircle2 size={14} className="text-blue-500 shrink-0 mt-1" />
                                  <p>{p}</p>
                               </li>
                            );
                          }) || <p className="text-base text-slate-500 italic">無特定規範，請討論一般設計細節</p>}
                       </ul>
                    </div>

                    {/* Feedback Form */}
                    <div className="space-y-4">
                      <div className="flex justify-between items-end">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">護理長意見紀錄</label>
                        <button 
                          onClick={startVoiceToText}
                          className={`text-xs font-bold hover:underline cursor-pointer flex items-center gap-1 transition-all ${isListening ? 'text-red-500 animate-pulse' : 'text-blue-500'}`}
                        >
                          <Sparkles size={12} /> {isListening ? '收音中...' : 'AI 語音轉文字'}
                        </button>
                      </div>
                      <textarea 
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="記錄意見回饋..."
                        className="w-full h-40 p-5 bg-[#F2F2F7] border border-slate-300 rounded-xl text-base text-slate-900 focus:border-blue-500/50 outline-none resize-none transition-all placeholder:text-slate-500"
                      />
                      <button 
                        onClick={handleAddNote}
                        disabled={!newNote.trim()}
                        className="w-full py-4 bg-blue-500 text-white rounded-lg font-bold shadow-lg shadow-blue-500/20 hover:bg-blue-600 disabled:opacity-50 transition-all active:scale-95 text-sm uppercase tracking-widest"
                      >
                        儲存討論進度
                      </button>
                    </div>

                    {/* Local History */}
                    <div className="space-y-4 pt-4 border-t border-slate-200">
                       <div className="flex items-center justify-between">
                         <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">當前會議紀錄</h4>
                         <button 
                           onClick={handleCompleteMeeting}
                           disabled={isCleaning}
                           className="flex items-center gap-2 px-3 py-1.5 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600 disabled:opacity-50 transition-all active:scale-95 shadow-sm"
                         >
                           {isCleaning ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                           完成會議紀錄
                         </button>
                       </div>
                       {notes.filter(n => n.space === selectedSpace && n.floor === activeFloor).length === 0 ? (
                         <div className="text-center py-12 px-4 glass-panel border-dashed rounded-xl">
                            <MessageSquare size={32} className="mx-auto text-slate-800 mb-3" />
                            <p className="text-sm text-slate-500 italic">目前無紀錄</p>
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
              )}
            </div>
</aside>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {editingReq && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingReq(null)} className="absolute inset-0 bg-[#F2F2F7]/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-white border border-slate-300 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-2xl font-light text-slate-900">編輯規範內容</h3>
              <div className="space-y-4">
                <input 
                  type="text" 
                  value={editingReq.title}
                  onChange={(e) => setEditingReq({ ...editingReq, title: e.target.value })}
                  className="w-full bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-blue-500"
                />
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">規範要點 (每行一個)</label>
                  <textarea 
                    value={editingReq.points.join('\n')}
                    onChange={(e) => setEditingReq({ ...editingReq, points: e.target.value.split('\n') })}
                    className="w-full h-64 bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-700 outline-none focus:border-blue-500 resize-none font-light leading-relaxed"
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setEditingReq(null)} className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-200">取消</button>
                 <button onClick={handleUpdateRequirement} className="flex-2 py-4 bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-600">儲存變更</button>
              </div>
            </motion.div>
          </div>
        )}

        {editingNote && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingNote(null)} className="absolute inset-0 bg-[#F2F2F7]/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-xl bg-white border border-slate-300 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-2xl font-light text-slate-900">編輯會議紀錄</h3>
              <div className="space-y-4">
                <textarea 
                  value={editingNote.content}
                  onChange={(e) => setEditingNote({ ...editingNote, content: e.target.value })}
                  className="w-full h-48 bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-700 outline-none focus:border-blue-500 resize-none font-light leading-relaxed"
                />
              </div>
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setEditingNote(null)} className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-200">取消</button>
                 <button onClick={handleUpdateNote} className="flex-2 py-4 bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-600">儲存</button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddCheckModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddCheckModal(false)} className="absolute inset-0 bg-[#F2F2F7]/80 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-md bg-white border border-slate-300 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              <h3 className="text-2xl font-light text-slate-900">新增查檢項目</h3>
              <input 
                type="text" 
                value={newCheckText}
                onChange={(e) => setNewCheckText(e.target.value)}
                placeholder="例如：病房門色樣確認..."
                className="w-full bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-blue-500"
              />
              <div className="flex gap-3 pt-4">
                 <button onClick={() => setShowAddCheckModal(false)} className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-200">取消</button>
                 <button onClick={handleAddCheck} className="flex-2 py-4 bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-600">新增項目</button>
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
              className="absolute inset-0 bg-[#F2F2F7]/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-md bg-white border border-slate-300 rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6"
            >
               <h3 className="text-2xl font-light text-slate-900">新增配置圖/樓層</h3>
               <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">配置圖名稱</label>
                    <input 
                      type="text"
                      value={newMapData.name}
                      onChange={(e) => setNewMapData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="例如：B2F 護理空間..."
                      className="w-full bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-500 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">圖面網址 (Image 或 3D URL)</label>
                    <input 
                      type="text"
                      value={newMapData.url}
                      onChange={(e) => setNewMapData(prev => ({ ...prev, url: e.target.value }))}
                      placeholder="https://..."
                      className="w-full bg-[#F2F2F7] border border-slate-200 rounded-xl px-4 py-3 text-base text-slate-900 outline-none focus:border-blue-500 transition-all font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">類型</label>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setNewMapData(prev => ({ ...prev, type: 'image' }))}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${newMapData.type === 'image' ? 'bg-blue-500 text-white' : 'bg-[#F2F2F7] text-slate-500 border border-slate-200'}`}
                       >2D 圖片</button>
                       <button 
                        onClick={() => setNewMapData(prev => ({ ...prev, type: '3d' }))}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold uppercase tracking-widest transition-all ${newMapData.type === '3d' ? 'bg-blue-500 text-white' : 'bg-[#F2F2F7] text-slate-500 border border-slate-200'}`}
                       >3D 模型</button>
                    </div>
                  </div>
               </div>
               <div className="flex gap-3 pt-4">
                 <button 
                  onClick={() => setShowAddMapModal(false)}
                  className="flex-1 py-4 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-slate-200 transition-all"
                 >取消</button>
                 <button 
                  onClick={handleAddMap}
                  disabled={!newMapData.name || !newMapData.url}
                  className="flex-2 py-4 bg-blue-500 text-white rounded-xl font-bold text-sm uppercase tracking-widest hover:bg-blue-600 disabled:opacity-50 transition-all"
                 >儲存圖面</button>
               </div>
            </motion.div>
          </div>
        )}

        {showApiModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-panel rounded-2xl p-8 max-w-md w-full shadow-2xl relative"
            >
              <button 
                onClick={() => setShowApiModal(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-900"
              >
                <X size={20} />
              </button>
              
              <div className="flex flex-col items-center text-center space-y-4 mb-8">
                <div className="bg-blue-500/20 p-4 rounded-full text-blue-500">
                  <Key size={32} />
                </div>
                <h3 className="text-2xl font-light text-slate-900 uppercase tracking-tight">設定專屬 API KEY</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  若您希望使用自定義的 Gemini API Key，請在此輸入。這將覆蓋系統預設的金鑰。金鑰將僅存在於本次瀏覽，不會持久存儲於伺服器。
                </p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-widest">Gemini API Key</label>
                  <input 
                    type="text"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="在此貼上您的 AIza... 開頭金鑰"
                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-base text-blue-600 outline-none focus:border-blue-500 transition-all font-mono"
                  />
                </div>
                <button 
                  onClick={handleSetApiKey}
                  className="w-full py-4 bg-blue-500 text-white font-bold rounded-xl text-sm uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95"
                >
                  確認並連結 AI
                </button>
                <p className="text-xs text-center text-slate-500">
                  尚未有金鑰？ <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">前往 Google AI Studio 獲取</a>
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NavItem({ 
  icon, 
  label, 
  active, 
  onClick, 
  collapsed,
  onDoubleClick,
  isEditing,
  editValue,
  onEditChange,
  onEditSubmit,
  onEditCancel,
  onDelete
}: { 
  icon: React.ReactNode, 
  label: string, 
  active: boolean, 
  onClick: () => void, 
  collapsed: boolean,
  onDoubleClick?: () => void,
  isEditing?: boolean,
  editValue?: string,
  onEditChange?: (val: string) => void,
  onEditSubmit?: () => void,
  onEditCancel?: () => void,
  onDelete?: () => void
}) {
  if (isEditing) {
    return (
      <div className="w-full flex items-center gap-2 p-2 rounded-lg bg-blue-500/5 border border-blue-500 mb-1">
         <input 
            autoFocus
            type="text" 
            value={editValue}
            onChange={(e) => onEditChange?.(e.target.value)}
            onKeyDown={(e) => {
               if (e.key === 'Enter') onEditSubmit?.();
               if (e.key === 'Escape') onEditCancel?.();
            }}
            onBlur={onEditSubmit}
            className="w-full bg-white border border-slate-300 rounded px-2 py-1 text-sm text-blue-600 outline-none"
         />
      </div>
    );
  }

  return (
    <div className="relative group/nav mb-1">
      <button 
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        title={onDoubleClick ? "雙擊可編輯名稱" : ""}
        className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-300 ${
          active 
            ? 'bg-blue-500/10 text-blue-600 border border-blue-500/20 active-tab' 
            : 'text-slate-500 hover:bg-black/5 hover:text-slate-700'
        } ${collapsed && 'justify-center'}`}
      >
        <span className={`${active ? 'text-blue-500' : 'text-slate-500 group-hover:text-blue-600'} transition-colors shrink-0`}>{icon}</span>
        {!collapsed && <span className="truncate text-sm font-bold uppercase tracking-wider">{label}</span>}
      </button>
      {!collapsed && onDelete && !active && (
        <button 
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 bg-red-500 text-white rounded-md opacity-0 group-hover/nav:opacity-100 transition-opacity"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function Hotspot({ label, color = "blue", onClick }: { label: string, color?: string, onClick: () => void }) {
  const colorClass = color === "blue" ? "bg-blue-500 text-white shadow-blue-500/30" : "bg-red-500 text-white shadow-red-500/30";

  return (
    <button 
      onClick={onClick}
      className={`relative flex items-center justify-center group active:scale-90 transition-all z-10`}
    >
      <span className={`absolute flex h-10 w-10 items-center justify-center rounded-full ${color === "blue" ? "bg-blue-500" : "bg-red-500"} opacity-20 animate-ping`} />
      <span className={`relative w-8 h-8 rounded-full ${colorClass} border-4 border-white shadow-2xl flex items-center justify-center scale-100 group-hover:scale-110 transition-transform`}>
         <Layout size={12} />
      </span>
      
      <div className={`absolute bottom-full mb-3 left-1/2 -translate-x-1/2 p-0.5 rounded bg-white border border-slate-200 shadow-2xl opacity-0 group-hover:opacity-100 transition-all translate-y-2 group-hover:translate-y-0 whitespace-nowrap z-[100]`}>
        <div className={`px-3 py-1.5 rounded text-xs font-bold tracking-widest uppercase ${color === 'blue' ? 'text-blue-600' : 'text-red-400'}`}>
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
      className={`p-4 glass-panel rounded-xl hover:bg-black/5 transition-all group border-l-2 ${note.status === 'confirmed' ? 'border-l-emerald-500' : 'border-l-blue-500/50'}`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-slate-500">{note.timestamp}</span>
          {note.status === 'confirmed' && (
            <span className="text-[10px] font-black bg-emerald-500 text-white px-1.5 rounded uppercase tracking-tighter">Confirmed</span>
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
            className="text-slate-500 hover:text-blue-600 p-1"
            title="編輯內容"
           >
            <FileText size={12} />
           </button>
           <button 
            onClick={() => onDelete(note.id)}
            className="text-slate-500 hover:text-red-500 p-1"
            title="刪除紀錄"
           >
            <X size={12} />
           </button>
        </div>
      </div>
      {showLabel && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 text-blue-600 text-[10px] font-bold rounded mb-3 tracking-widest uppercase border border-blue-500/20">
          {note.floor} • {note.space}
        </span>
      )}
      <p className={`text-sm leading-relaxed italic tracking-wide ${note.status === 'confirmed' ? 'text-slate-900 font-medium' : 'text-slate-700 font-light'}`}>
        「{note.content}」
      </p>
    </motion.div>
  );
}
