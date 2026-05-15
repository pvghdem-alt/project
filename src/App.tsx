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
  FileUp,
  Copy,
  GripVertical,
  Edit,
  Trash2,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import Markdown from 'react-markdown';
import { DESIGN_SPECS } from './constants';
import { askAiAssistant, setCustomApiKey, analyzeNotesToRequirements, deduplicateData, analyzeFileToSpecs } from './geminiService';
import { db, auth } from './lib/firebase';
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
  writeBatch,
  where,
  getDocs
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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
  space?: string;
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
  const [customTopics, setCustomTopics] = useState<Topic[]>([]);
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
  const [editingFloorId, setEditingFloorId] = useState<string | null>(null);
  const [floorEditName, setFloorEditName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, name: string, type: 'topic' | 'floor' } | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<'discussion' | 'map'>('discussion');
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
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'maps');
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
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'requirements');
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
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'notes');
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Topics
  useEffect(() => {
    const q = query(collection(db, 'topics'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Topic[];
      
      if (data.length === 0) {
        // Seed default topics if nothing in DB
        const defaultTopics = [
          { name: '護理站', isDefault: true, order: 0 },
          { name: '一般病房', isDefault: true, order: 1 },
          { name: '保護室', isDefault: true, order: 2 },
          { name: '公共活動區', isDefault: true, order: 3 }
        ];
        defaultTopics.forEach((t, i) => {
          addDoc(collection(db, 'topics'), {
            ...t,
            createdAt: serverTimestamp(),
            creatorId: 'system',
            floorId: 'global' // Global defaults
          });
        });
      } else {
        setCustomTopics(data);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'topics');
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
      setNotification({ message: '紀錄已儲存！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'notes');
    }
  };

  const handleCompleteMeeting = async () => {
    if (!selectedSpace) return;
    setIsCleaning(true);
    setNotification({ message: 'AI 正在整合會議紀錄至工程規範...', type: 'ai' });
    try {
      const CATEGORIES = ['醫療氣體設備', '燈光控制', '空調設備', '衛浴設備', '櫥櫃/家具', '天花板', '地面工程', '牆壁/油漆', '電力/資訊', '消防設備', '門窗工程', '護士呼叫系統'];
      const currentSpaceReqs = requirements.filter(r => r.title === selectedSpace || r.title.includes(selectedSpace));
      const categoryReqs = requirements.filter(r => CATEGORIES.includes(r.title));
      const sourceReqs = [...currentSpaceReqs, ...categoryReqs];
      
      const sourceNotes = notes.filter(n => n.space === selectedSpace && n.floor === activeFloor && n.status === 'pending');

      if (sourceNotes.length === 0) {
         setNotification({ message: '無新會議紀錄可整合', type: 'error' });
         setIsCleaning(false);
         setTimeout(() => setNotification(null), 2000);
         return;
      }

      const updatedReqs = await analyzeNotesToRequirements(
        sourceReqs.length ? sourceReqs : [{ title: selectedSpace, points: [] }], 
        sourceNotes,
        selectedSpace
      );
      
      if (updatedReqs && updatedReqs.length > 0) {
          const batch = writeBatch(db);
          
          for (const req of updatedReqs) {
            // Find matching requirement in Firestore data for this specific space
            const existing = requirements.find(r => 
              r.title === req.title && r.space === selectedSpace
            );

            if (existing && !existing.id.startsWith('default-') && existing.id !== 'new') {
              batch.update(doc(db, 'requirements', existing.id), {
                points: req.points,
                updatedAt: serverTimestamp()
              });
            } else {
              // Either default or doesn't exist, create a new doc
              const newRef = doc(collection(db, 'requirements'));
              batch.set(newRef, { 
                title: req.title, 
                points: req.points, 
                space: selectedSpace,
                updatedAt: serverTimestamp() 
              });
            }
          }
          
          // Update note status to confirmed after integration
          const noteUpdateBatch = writeBatch(db);
          sourceNotes.forEach(n => {
            if (n.status === 'pending') {
              noteUpdateBatch.update(doc(db, 'notes', n.id), { status: 'confirmed' });
            }
          });
          await noteUpdateBatch.commit();

          await batch.commit();
          setNotification({ message: '工程規範已自動彙整分類！', type: 'success' });
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
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'checklist');
    });
    return () => unsubscribe();
  }, []);

  const handleUpdateRequirement = async () => {
    if (!editingReq) return;
    try {
      if (editingReq.id.startsWith('default-') || editingReq.id === 'new') {
        // Create new doc since it was just local fallback or placeholder
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
      
      const updatedReqs = await analyzeNotesToRequirements(requirements, analysisInput, selectedSpace || 'General');
      
      if (updatedReqs && Array.isArray(updatedReqs)) {
        const batch = writeBatch(db);
        
        // Update requirements in Firestore
        for (const req of updatedReqs) {
          // If title matches existing, update. Otherwise create new.
          const existing = requirements.find(r => r.title === req.title && r.space === (selectedSpace || 'General'));
          if (existing) {
            batch.update(doc(db, 'requirements', existing.id), {
              points: req.points,
              updatedAt: serverTimestamp()
            });
          } else {
            const reqRef = doc(collection(db, 'requirements'));
            batch.set(reqRef, { 
              ...req, 
              space: selectedSpace || 'General',
              updatedAt: serverTimestamp() 
            });
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

  const handleUpdateTopic = async (id: string) => {
    if (!topicEditName.trim()) return;
    try {
      await updateDoc(doc(db, 'topics', id), { name: topicEditName.trim() });
      setEditingTopicId(null);
      setNotification({ message: '空間名稱已更新', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTopic = (id: string, name: string) => {
    setDeleteConfirm({ id, name, type: 'topic' });
  };

  const performDeleteTopic = async (id: string, name: string) => {
    try {
      if (selectedSpace === name) setSelectedSpace(null);
      await deleteDoc(doc(db, 'topics', id));
      
      const topicNotes = notes.filter(n => n.space === name);
      if (topicNotes.length > 0) {
        const batch = writeBatch(db);
        topicNotes.forEach(n => {
          batch.delete(doc(db, 'notes', n.id));
        });
        await batch.commit();
      }

      setNotification({ message: '空間及相關紀錄已刪除', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setDeleteConfirm(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateFloor = async (id: string) => {
    if (!floorEditName.trim()) return;
    try {
      await updateDoc(doc(db, 'maps', id), { name: floorEditName.trim() });
      setEditingFloorId(null);
      setNotification({ message: '配置圖名稱已更新', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteFloor = (id: string, name: string) => {
    setDeleteConfirm({ id, name, type: 'floor' });
  };

  const performDeleteFloor = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'maps', id));
      setNotification({ message: '配置圖已刪除', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
      setDeleteConfirm(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyTopic = async (topic: Topic) => {
    try {
      const newName = `${topic.name} (複製)`;
      const newTopicRef = await addDoc(collection(db, 'topics'), {
        name: newName,
        createdAt: serverTimestamp(),
        creatorId: 'public',
        floorId: topic.floorId,
        order: (customTopics[customTopics.length - 1]?.order || 0) + 1,
        isDefault: false
      });

      // Copy existing notes for this topic
      const notesQ = query(collection(db, 'notes'), where('space', '==', topic.name));
      const notesSnapshot = await getDocs(notesQ);
      
      if (!notesSnapshot.empty) {
        const batch = writeBatch(db);
        notesSnapshot.docs.forEach((noteDoc) => {
          const data = noteDoc.data();
          const newNoteRef = doc(collection(db, 'notes'));
          batch.set(newNoteRef, {
            ...data,
            space: newName,
            createdAt: serverTimestamp(),
            timestamp: `${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
          });
        });
        await batch.commit();
      }

      setNotification({ message: `已複製空間「${newName}」並複製 ${notesSnapshot.size} 筆紀錄`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error(err);
      setNotification({ message: '複製失敗', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const handleReorderTopics = async (newOrder: Topic[]) => {
    setCustomTopics(newOrder); // Optimistic update
    try {
      const batch = writeBatch(db);
      newOrder.forEach((topic, i) => {
        batch.update(doc(db, 'topics', topic.id), { order: i });
      });
      await batch.commit();
    } catch (err) {
      console.error("Reorder failed:", err);
    }
  };

  const handleAddTopic = async () => {
    const trimmedName = newTopicName.trim();
    if (!trimmedName) return;

    // Check if this name already exists in THIS floor or is a global default
    const isDuplicate = customTopics.some(t => 
      t.name === trimmedName && (t.isDefault || t.floorId === activeFloor || t.floorId === 'global')
    );

    if (isDuplicate) {
      setNotification({ message: '此空間名稱已存在', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    try {
      await addDoc(collection(db, 'topics'), {
        name: trimmedName,
        createdAt: serverTimestamp(),
        creatorId: 'public',
        floorId: activeFloor,
        order: (customTopics[customTopics.length - 1]?.order || 0) + 1,
        isDefault: false
      });
      setNewTopicName('');
      setShowAddTopic(false);
      setNotification({ message: `空間「${trimmedName}」已新增`, type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error("Error adding topic:", err);
      setNotification({ message: '新增失敗，請重試', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
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
                 onDelete={() => handleDeleteFloor(map.id, map.name)}
                 onDoubleClick={() => { setEditingFloorId(map.id); setFloorEditName(map.name); }}
                 isEditing={editingFloorId === map.id}
                 editValue={floorEditName}
                 onEditChange={setFloorEditName}
                 onEditSubmit={() => handleUpdateFloor(map.id)}
                 onEditCancel={() => setEditingFloorId(null)}
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
             </div>

             <button 
                onClick={() => setShowAddTopic(!showAddTopic)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors mb-2 ${!sidebarOpen && 'justify-center'}`}
             >
                <PlusCircle size={18} />
                {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">新增設計空間</span>}
             </button>

             {sidebarOpen && showAddTopic && (
               <div className="mb-4 flex flex-col gap-2 px-4 py-3 bg-blue-50/50 rounded-xl border border-blue-100 mx-2">
                 <input 
                   autoFocus
                   type="text"
                   value={newTopicName}
                   onChange={(e) => setNewTopicName(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleAddTopic()}
                   placeholder="例如：會客室、配膳間..."
                   className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-all"
                 />
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setShowAddTopic(false)}
                     className="flex-1 py-1.5 text-xs text-slate-500 font-bold hover:bg-white rounded border border-slate-200"
                   >取消</button>
                   <button 
                     onClick={handleAddTopic}
                     className="flex-1 py-1.5 bg-blue-500 text-white rounded text-xs font-bold shadow-sm"
                   >確認新增</button>
                 </div>
               </div>
             )}

             <Reorder.Group axis="y" values={customTopics.filter(t => t.isDefault || t.floorId === activeFloor || t.floorId === 'global')} onReorder={handleReorderTopics} className="space-y-1">
                {customTopics.filter(t => t.isDefault || t.floorId === activeFloor || t.floorId === 'global').map((topic) => (
                  <Reorder.Item key={topic.id} value={topic}>
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
                 onEditSubmit={() => handleUpdateTopic(topic.id)}
                 onEditCancel={() => setEditingTopicId(null)}
                 onDelete={!topic.isDefault ? () => handleDeleteTopic(topic.id, topic.name) : undefined}
                 onCopy={() => handleCopyTopic(topic)}
                 isSortable={true}
               />
             </Reorder.Item>
           ))}
         </Reorder.Group>
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
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden bg-brand-bg p-6 relative">
            <AnimatePresence>
              {notification && (
                <motion.div 
                  initial={{ opacity: 0, y: -20, x: '-50%' }}
                  animate={{ opacity: 1, y: 0, x: '-50%' }}
                  exit={{ opacity: 0, y: -20, x: '-50%' }}
                  className={`fixed top-20 left-1/2 px-6 py-3 rounded-full font-bold text-base shadow-2xl z-[100] flex items-center gap-2 border whitespace-nowrap ${
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

            {/* Tab Navigation */}
            <div className="flex items-center justify-between mb-4 shrink-0">
               <div className="flex p-1 bg-slate-200/50 rounded-xl backdrop-blur-sm border border-slate-200 shadow-sm">
                  <button 
                    onClick={() => setActiveMainTab('discussion')}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                      activeMainTab === 'discussion' 
                        ? 'bg-white text-blue-600 shadow-lg' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MessageSquare size={16} />
                    討論紀錄
                  </button>
                  <button 
                    onClick={() => setActiveMainTab('map')}
                    className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                      activeMainTab === 'map' 
                        ? 'bg-white text-blue-600 shadow-lg' 
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <MapIcon size={16} />
                    配置圖
                  </button>
               </div>
               
               {activeMainTab === 'discussion' && selectedSpace && (
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={handleCompleteMeeting}
                      disabled={isCleaning}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20"
                    >
                      {isCleaning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      AI 彙整至工程規範
                    </button>
                  </div>
               )}
            </div>

            {/* Main Content Pane */}
            <div className="flex-1 flex overflow-hidden gap-6 lg:gap-8">
              <div className="flex-1 glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/40 relative flex flex-col">
                {activeMainTab === 'map' ? (
                  <div className="flex-1 relative overflow-hidden flex flex-col">
                    <div className="p-4 border-b border-slate-100 bg-white/50 backdrop-blur-md flex justify-between items-center z-10 shrink-0">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest px-2">
                         <Info size={14} className="text-blue-500" /> 圖面即時檢視
                      </div>
                    </div>
                    <div className="flex-1 relative overflow-auto p-4 flex items-center justify-center bg-brand-bg/30">
                      <div className="relative w-full h-full opacity-90 transition-opacity">
                        {activeMap.type === '3d' ? (
                          <iframe 
                            src={activeMap.viewerUrl}
                            className="w-full h-full border-0 rounded-2xl shadow-inner bg-slate-100"
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
                ) : (
                  <div className="flex-1 overflow-y-auto custom-scrollbar bg-white/50">
                    {!selectedSpace ? (
                      <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
                        <div className="bg-slate-100 p-6 rounded-full">
                          <Layout size={48} className="text-slate-300" />
                        </div>
                        <p className="text-lg font-medium">請從左側選單選擇一個空間進行討論</p>
                      </div>
                    ) : (
                      <div className="h-full flex flex-col p-6 lg:p-8 space-y-6">
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
                          <div>
                            <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">空間細部規範</h4>
                            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{selectedSpace}</h3>
                          </div>
                          <button 
                            onClick={() => setSelectedSpace(null)} 
                            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl transition-colors lg:hidden"
                          >
                            <X size={20} />
                          </button>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
                          <div className="bg-blue-600/5 border border-blue-500/10 rounded-2xl p-6">
                            <div className="flex justify-between items-center mb-6 sticky top-0 bg-transparent backdrop-blur-sm pb-2">
                              <h4 className="text-base font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                <ShieldAlert size={18} /> 設計規範明細
                              </h4>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                              {(() => {
                                const filtered = requirements.filter(k => 
                                  (k.space === selectedSpace) ||
                                  (!k.space && (k.title === selectedSpace || k.title.includes(selectedSpace || '')))
                                );

                                if (filtered.length === 0) return <p className="text-slate-500 text-sm italic col-span-full text-center py-12">無特定規範，請點擊右側輸入討論細節</p>;

                                return filtered.filter(k => k.points.length > 0).map((cat) => (
                                  <div key={cat.id} className="space-y-4 p-5 bg-white/60 rounded-2xl border border-blue-500/10 group shadow-sm hover:shadow-md transition-all">
                                    <div className="flex justify-between items-center">
                                      <h5 className="text-lg font-black text-blue-700 border-l-4 border-blue-500 pl-4 py-1 uppercase tracking-tight">
                                        {cat.title}
                                      </h5>
                                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                          onClick={() => setEditingReq({ id: cat.id, title: cat.title, points: cat.points })}
                                          className="p-2 hover:bg-blue-100 text-blue-600 rounded-xl"
                                        >
                                          <Edit size={16} />
                                        </button>
                                        {!cat.id.startsWith('default-') && (
                                          <button 
                                            onClick={async () => {
                                              if (window.confirm(`確定要刪除「${cat.title}」分類嗎？`)) {
                                                await deleteDoc(doc(db, 'requirements', cat.id));
                                              }
                                            }}
                                            className="p-2 hover:bg-red-100 text-red-600 rounded-xl"
                                          >
                                            <Trash2 size={16} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    <ul className="space-y-3 pl-1">
                                      {cat.points.map((p, i) => (
                                        <li key={i} className="flex gap-3 text-base text-slate-700 leading-relaxed group/item">
                                          <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0 mt-2.5 transition-transform group-hover/item:scale-150" />
                                          <p className="flex-1 font-medium">{p}</p>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Persistent Right Sidebar for Discussion - Visible when space is selected */}
              {selectedSpace && (
                <div className="hidden lg:flex flex-col w-[380px] h-full space-y-6 overflow-hidden shrink-0">
                  {/* Note Input */}
                  <div className="bg-white border border-slate-200 rounded-3xl p-6 space-y-5 shadow-xl shadow-slate-200/20 flex flex-col shrink-0">
                    <div className="flex justify-between items-center">
                      <label className="text-sm font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                        <MessageSquare size={16} /> 意見與回饋
                      </label>
                      <button 
                        onClick={startVoiceToText}
                        className={`text-[11px] font-bold flex items-center gap-2 px-4 py-2 rounded-full transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100'}`}
                      >
                        <Sparkles size={14} /> {isListening ? '聽取中...' : '語音輸入'}
                      </button>
                    </div>
                    <textarea 
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      placeholder="請輸入討論建議（支持白話，AI 會代為修飾）..."
                      className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-base text-slate-900 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 shadow-inner outline-none resize-none transition-all placeholder:text-slate-400"
                    />
                    <button 
                      onClick={handleAddNote}
                      disabled={!newNote.trim()}
                      className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-500/20 hover:bg-blue-700 hover:shadow-blue-500/30 disabled:opacity-50 transition-all active:scale-[0.98] text-sm tracking-widest uppercase"
                    >
                      送出討論內容
                    </button>
                  </div>

                  {/* History Timeline */}
                  <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/20 overflow-hidden">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                      <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-1">
                        <RotateCcw size={16} /> 歷史討論紀錄
                      </h4>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar relative px-1">
                      <div className="absolute left-6 top-0 bottom-0 w-px bg-slate-100 z-0" />
                      <div className="relative z-10">
                        <NotesArchived 
                          notes={notes.filter(n => n.space === selectedSpace && n.floor === activeFloor)}
                          onToggleStatus={handleToggleNoteStatus}
                          onDelete={handleDeleteNote}
                          onEdit={(note) => setEditingNote(note)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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

      {/* Custom Confirmation Modal */}
      <AnimatePresence>
        {deleteConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeleteConfirm(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden p-8"
            >
              <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                <X size={32} className="text-red-500" />
              </div>
              <h3 className="text-xl font-black text-center text-slate-900 mb-2">確認刪除？</h3>
              <p className="text-center text-slate-500 mb-8 leading-relaxed">
                您確定要刪除 <span className="font-bold text-slate-800">「{deleteConfirm.name}」</span> 嗎？
                {deleteConfirm.type === 'topic' && <><br /><span className="text-xs text-red-500">所有相關的討論紀錄也將一併移除。</span></>}
                此操作無法復原。
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 py-3 px-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    if (deleteConfirm.type === 'topic') {
                      performDeleteTopic(deleteConfirm.id, deleteConfirm.name);
                    } else {
                      performDeleteFloor(deleteConfirm.id);
                    }
                  }}
                  className="flex-1 py-3 px-4 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/30"
                >
                  確定刪除
                </button>
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
  onDelete,
  onCopy,
  isSortable
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
  onDelete?: () => void,
  onCopy?: () => void,
  isSortable?: boolean
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
        {isSortable && !collapsed && (
          <span className="text-slate-300 group-hover/nav:text-slate-500 cursor-grab active:cursor-grabbing">
            <GripVertical size={14} />
          </span>
        )}
        <span className={`${active ? 'text-blue-500' : 'text-slate-500 group-hover:text-blue-600'} transition-colors shrink-0`}>{icon}</span>
        {!collapsed && <span className="truncate text-sm font-bold uppercase tracking-wider">{label}</span>}
      </button>
      {!collapsed && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover/nav:opacity-100 transition-opacity">
          {onCopy && !active && (
            <button 
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              className="p-1 hover:bg-blue-500 hover:text-white text-slate-400 rounded-md transition-colors"
              title="複製主題"
            >
              <Copy size={12} />
            </button>
          )}
          {!active && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
              className="p-1 hover:bg-blue-500 hover:text-white text-slate-400 rounded-md transition-colors"
              title="編輯名稱"
            >
              <FileText size={12} />
            </button>
          )}
          {onDelete && !active && (
            <button 
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              className="p-1 hover:bg-red-500 hover:text-white text-slate-400 rounded-md transition-colors"
              title="刪除"
            >
              <X size={12} />
            </button>
          )}
        </div>
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
  const isConfirmed = note.status === 'confirmed';
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 glass-panel rounded-xl hover:bg-black/5 transition-all group border-l-2 mb-2 ${isConfirmed ? 'border-l-emerald-500 bg-emerald-50/10' : 'border-l-red-500/50 bg-red-50/10'}`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{note.timestamp.split(' ')[1] || note.timestamp}</span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm ${
            isConfirmed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {isConfirmed ? '已加入' : '未加入'}
          </span>
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
           <button 
            onClick={() => onToggleStatus(note.id, note.status)}
            className={`${note.status === 'confirmed' ? 'text-emerald-500' : 'text-slate-500 hover:text-emerald-400'} p-0.5`}
            title="確認狀態"
           >
            <CheckCircle2 size={10} />
           </button>
           <button 
            onClick={() => onEdit(note)}
            className="text-slate-500 hover:text-blue-600 p-0.5"
            title="編輯內容"
           >
            <FileText size={10} />
           </button>
           <button 
            onClick={() => onDelete(note.id)}
            className="text-slate-500 hover:text-red-500 p-0.5"
            title="刪除紀錄"
           >
            <X size={10} />
           </button>
        </div>
      </div>
      {showLabel && (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-blue-500/10 text-blue-600 text-[10px] font-bold rounded mb-2 tracking-widest uppercase border border-blue-500/20">
          {note.floor} • {note.space}
        </span>
      )}
      <p className={`text-sm leading-relaxed tracking-wide ${note.status === 'confirmed' ? 'text-slate-900 font-medium' : 'text-slate-700 font-light'}`}>
        {note.content}
      </p>
    </motion.div>
  );
}

function NotesArchived({ notes, onToggleStatus, onDelete, onEdit }: { notes: Note[], onToggleStatus: any, onDelete: any, onEdit: any }) {
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  // Group by date
  const grouped = notes.reduce((acc: Record<string, Note[]>, note) => {
    const date = note.timestamp.split(' ')[0] || 'Unknown Date';
    if (!acc[date]) acc[date] = [];
    acc[date].push(note);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  useEffect(() => {
    // Expand latest date by default
    if (dates.length > 0 && expandedDates.length === 0) {
      setExpandedDates([dates[0]]);
    }
  }, [dates]);

  const toggleDate = (date: string) => {
    setExpandedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);
  };

  if (notes.length === 0) {
    return (
      <div className="text-center py-12 px-4 glass-panel border-dashed rounded-xl">
        <MessageSquare size={32} className="mx-auto text-slate-800 mb-3" />
        <p className="text-sm text-slate-500 italic">目前無紀錄</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {dates.map(date => (
        <div key={date} className="space-y-2">
          <button 
            onClick={() => toggleDate(date)}
            className="w-full flex items-center justify-between py-2 border-b border-slate-100 hover:bg-black/5 px-2 rounded transition-colors group"
          >
            <div className="flex items-center gap-2">
               <span className={`text-xs font-bold ${expandedDates.includes(date) ? 'text-blue-600' : 'text-slate-500'}`}>📅 {date}</span>
               <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">{grouped[date].length}</span>
            </div>
            {expandedDates.includes(date) ? <ChevronDown size={14} className="text-blue-500" /> : <ChevronRight size={14} className="text-slate-400" />}
          </button>
          
          <AnimatePresence>
            {expandedDates.includes(date) && (
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-2 pl-2"
              >
                {grouped[date].map(note => (
                  <NoteItem 
                    key={note.id} 
                    note={note} 
                    onToggleStatus={onToggleStatus} 
                    onDelete={onDelete} 
                    onEdit={onEdit} 
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ))}
    </div>
  );
}
