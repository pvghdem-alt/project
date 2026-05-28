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
  Activity,
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
  ChevronDown,
  ChevronLeft,
  Camera,
  UploadCloud,
  Settings,
  PenTool
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import Markdown from 'react-markdown';
import imageCompression from 'browser-image-compression';
import AnnotationView from './components/AnnotationView';
import { DESIGN_SPECS } from './constants';
import { askAiAssistant, setCustomApiKey, analyzeNotesToRequirements, deduplicateData, analyzeFileToSpecs } from './geminiService';
import { db, auth } from './lib/firebase';
import { signInWithEmailAndPassword, onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel, TableOfContents, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType, PageNumber, Footer, TabStopType, LeaderType, Tab } from 'docx';
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
  getDocs,
  limit
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
  if (!errInfo.error.includes('Quota limit exceeded')) {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  // Not throwing to prevent app crash on Firebase Quota limits.
}

type FloorKey = string;

interface ProjectMap {
  id: string;
  name: string;
  viewerUrl: string;
  type: '3d' | 'image';
  order: number;
  floorPlan2DUrl?: string;
  floorPlan2DDriveFileId?: string;
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
  authorEmail?: string | null;
  createdAt?: any;
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
  type?: 'space' | 'trade';
}

interface SpacePhoto {
  id: string;
  space: string;
  url: string; // Base64 compressed or Google Drive link
  description?: string;
  createdAt: any;
  authorId: string;
  driveFileId?: string;
}

function getRequirementsForSpace(reqs: RequirementCategory[], space: string | null) {
  if (!space) return [];
  const specific = reqs.filter(k => k.space === space && !k.id.startsWith('default-'));
  if (specific.length > 0) return specific;
  return reqs.filter(k => !k.space && (k.title === space || k.title.includes(space)));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const isNursingDept = user?.email === 'user@ptvgh.gov.tw';
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  // Auth Error diagnostic & alternative options modal
  const [showAuthErrorModal, setShowAuthErrorModal] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [authErrorCode, setAuthErrorCode] = useState('');

  const [activeFloor, setActiveFloor] = useState<FloorKey>('B3F');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<'root' | 'space' | 'trade'>('root');
  const [isSidebarEditing, setIsSidebarEditing] = useState(false);
  const [viewScale, setViewScale] = useState(1);
  const [selectedSpace, setSelectedSpace] = useState<string | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [newNote, setNewNote] = useState('');
  const [isListening, setIsListening] = useState(false);
  
  // Custom Topics
  const [customTopics, setCustomTopics] = useState<Topic[]>([]);
  const [showAddTopic, setShowAddTopic] = useState<{ open: boolean, type: 'space' | 'trade' }>({ open: false, type: 'space' });
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
  const [activeSettingsTab, setActiveSettingsTab] = useState<'gemini' | 'gdrive'>('gemini');

  // Google Drive state
  const [googleAuthMethod, setGoogleAuthMethod] = useState<'firebase' | 'gsi'>(() => {
    return (localStorage.getItem('google_auth_method') as 'firebase' | 'gsi') || 'firebase';
  });
  const [googleClientId, setGoogleClientId] = useState(() => {
    const saved = localStorage.getItem('google_client_id');
    if (!saved || saved.includes('76552910163')) {
      return '501431628979-jecrmd9k54aqg96q7nj9qlblmhs34lm7.apps.googleusercontent.com';
    }
    return saved;
  });
  const [driveAccessToken, setDriveAccessToken] = useState<string | null>(null);
  const [isDriveConnecting, setIsDriveConnecting] = useState(false);

  useEffect(() => {
    const suffixes = ['_v4', '_v3', '_v2', ''];
    for (const suffix of suffixes) {
      const tokenKey = `drive_access_token${suffix}`;
      const expiresKey = `drive_token_expires_at${suffix}`;
      const savedToken = localStorage.getItem(tokenKey);
      const savedExpiresAt = localStorage.getItem(expiresKey);
      
      if (savedToken && savedExpiresAt) {
        if (Date.now() < Number(savedExpiresAt)) {
          setDriveAccessToken(savedToken);
          // Migrate to v4 for current version consistency
          if (suffix !== '_v4') {
            localStorage.setItem('drive_access_token_v4', savedToken);
            localStorage.setItem('drive_token_expires_at_v4', savedExpiresAt);
          }
          break;
        } else {
          localStorage.removeItem(tokenKey);
          localStorage.removeItem(expiresKey);
        }
      }
    }
  }, []);

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
  const [cachedAllRequirements, setCachedAllRequirements] = useState<RequirementCategory[] | null>(null);
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
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string, name: string, type: 'topic' | 'floor' | 'requirement' } | null>(null);
  const [pendingAiResult, setPendingAiResult] = useState<{ requirements: any[], summary: any, sourceNotes: any[] } | null>(null);
  const [selectedProposedPoints, setSelectedProposedPoints] = useState<Record<string, string[]>>({});
  const [activeMainTab, setActiveMainTab] = useState<'discussion' | 'photos' | 'map' | 'report' | 'plan'>('discussion');
  const [rightSidebarWidth, setRightSidebarWidth] = useState(400);
  const [expandedReqIds, setExpandedReqIds] = useState<string[]>([]);
  const [collapsedChatIndices, setCollapsedChatIndices] = useState<number[]>([]);
  const [isResizing, setIsResizing] = useState(false);

  const [spacePhotos, setSpacePhotos] = useState<SpacePhoto[]>([]);
  const currentSpacePhotos = spacePhotos.filter(p => p.space === selectedSpace);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [selectedLightboxPhoto, setSelectedLightboxPhoto] = useState<string | null>(null);
  const [showCopySpecsModal, setShowCopySpecsModal] = useState(false);
  const [copySpecsSelectedReqs, setCopySpecsSelectedReqs] = useState<string[]>([]);
  const [copySpecsSelectedTargets, setCopySpecsSelectedTargets] = useState<string[]>([]);
  const [isCopyingSpecs, setIsCopyingSpecs] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (!u) {
        setDriveAccessToken(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Guarantee only jason2134@gmail.com can view the report tab
  useEffect(() => {
    if (activeMainTab === 'report' && user?.email !== 'jason2134@gmail.com') {
      setActiveMainTab('discussion');
    }
  }, [user, activeMainTab]);

  // Handle keyboard events in Lightbox Modal for left/right/escapes
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!selectedLightboxPhoto) return;
      if (e.key === 'ArrowLeft') {
        const currentIndex = currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto);
        if (currentIndex > -1 && currentSpacePhotos.length > 0) {
          const nextIndex = (currentIndex - 1 + currentSpacePhotos.length) % currentSpacePhotos.length;
          setSelectedLightboxPhoto(currentSpacePhotos[nextIndex].url);
        }
      } else if (e.key === 'ArrowRight') {
        const currentIndex = currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto);
        if (currentIndex > -1 && currentSpacePhotos.length > 0) {
          const nextIndex = (currentIndex + 1) % currentSpacePhotos.length;
          setSelectedLightboxPhoto(currentSpacePhotos[nextIndex].url);
        }
      } else if (e.key === 'Escape') {
        setSelectedLightboxPhoto(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedLightboxPhoto, currentSpacePhotos]);

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
    if (!selectedSpace) {
      const defaults = DESIGN_SPECS.keyPoints.map((k, i) => ({ id: `default-${i}`, ...k })) as RequirementCategory[];
      setRequirements(defaults);
      return;
    }

    const q = query(
      collection(db, 'requirements'),
      where('space', '==', selectedSpace)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as RequirementCategory[];
      const defaults = DESIGN_SPECS.keyPoints.map((k, i) => ({ id: `default-${i}`, ...k })) as RequirementCategory[];
      
      const merged = [...data];
      defaults.forEach(def => {
        if (!data.some(d => d.title === def.title || (def.title.includes('保護室') && d.title.includes('保護室')) || (def.title.includes('護理') && d.title.includes('護理')) || (def.title.includes('病房') && d.title.includes('病房')))) {
           merged.push(def);
        }
      });
      setRequirements(merged);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'requirements');
    });
    return () => unsubscribe();
  }, [selectedSpace]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (activeMainTab === 'report') {
      const q = query(collection(db, 'requirements'));
      unsubscribe = onSnapshot(q, (snapshot) => {
        const dbReqs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as RequirementCategory[];
        const defaults = DESIGN_SPECS.keyPoints.map((k, i) => ({ id: `default-${i}`, ...k })) as RequirementCategory[];
        
        const merged = [...dbReqs];
        defaults.forEach(def => {
          if (!dbReqs.some(d => d.title === def.title || (def.title.includes('保護室') && d.title.includes('保護室')) || (def.title.includes('護理') && d.title.includes('護理')) || (def.title.includes('病房') && d.title.includes('病房')))) {
             merged.push(def);
          }
        });
        setCachedAllRequirements(merged);
      }, (err) => {
        console.error("Failed to load global requirements for report", err);
        setCachedAllRequirements([]);
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeMainTab]);

  useEffect(() => {
    setShowHistory(false);
  }, [selectedSpace, activeFloor]);

  // Firestore Sync: Notes
  useEffect(() => {
    if (!selectedSpace) {
      setNotes([]);
      return;
    }
    
    let q;
    if (showHistory) {
      q = query(
        collection(db, 'notes'), 
        where('space', '==', selectedSpace),
        where('floor', '==', activeFloor)
      );
    } else {
      q = query(
        collection(db, 'notes'), 
        where('space', '==', selectedSpace),
        where('floor', '==', activeFloor),
        where('status', '==', 'pending')
      );
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Note[];
      
      // Local sort
      data.sort((a, b) => {
        const timeA = a.createdAt?.toMillis ? a.createdAt.toMillis() : new Date(a.timestamp).getTime();
        const timeB = b.createdAt?.toMillis ? b.createdAt.toMillis() : new Date(b.timestamp).getTime();
        return timeB - timeA;
      });
      
      setNotes(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'notes');
    });
    return () => unsubscribe();
  }, [selectedSpace, showHistory]);

  // Firestore Sync: Topics
  useEffect(() => {
    const seedTopicsInfo = async () => {
      if (localStorage.getItem('topics_seeded')) return;
      try {
        const snapshot = await getDocs(query(collection(db, 'topics'), limit(1)));
        if (snapshot.empty) {
          const defaultTopics = [
            { name: '護理站', isDefault: true, order: 0, type: 'space' },
            { name: '一般病房', isDefault: true, order: 1, type: 'space' },
            { name: '保護室', isDefault: true, order: 2, type: 'space' },
            { name: '公共活動區', isDefault: true, order: 3, type: 'space' },
            { name: '空調工程', isDefault: true, order: 4, type: 'trade' },
            { name: '醫療氣體工程', isDefault: true, order: 5, type: 'trade' }
          ] as const;
          const batch = writeBatch(db);
          defaultTopics.forEach((t, i) => {
            batch.set(doc(collection(db, 'topics')), {
              ...t,
              createdAt: serverTimestamp(),
              creatorId: 'system',
              floorId: 'global'
            });
          });
          await batch.commit();
        }
        localStorage.setItem('topics_seeded', 'true');
      } catch (err) {
        console.error("Topics seed failed:", err);
      }
    };
    seedTopicsInfo();

    const q = query(collection(db, 'topics'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Topic[];
      
      if (data.length > 0) {
        setCustomTopics(data);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'topics');
    });
    return () => unsubscribe();
  }, []);

  // Firestore Sync: Space Photos
  useEffect(() => {
    const q = query(collection(db, 'photos'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as SpacePhoto[];
      setSpacePhotos(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'photos');
    });
    return () => unsubscribe();
  }, []);

  // Load draft for the selected space/floor whenever it changes
  useEffect(() => {
    if (selectedSpace) {
      const draftKey = `note_draft_${activeFloor}_${selectedSpace}`;
      const savedDraft = localStorage.getItem(draftKey) || '';
      setNewNote(savedDraft);
    } else {
      setNewNote('');
    }
  }, [selectedSpace, activeFloor]);

  // Unified helper to change the note content and save draft immediately
  const handleNoteChange = (text: string) => {
    setNewNote(text);
    if (selectedSpace) {
      const draftKey = `note_draft_${activeFloor}_${selectedSpace}`;
      if (text.trim()) {
        localStorage.setItem(draftKey, text);
      } else {
        localStorage.removeItem(draftKey);
      }
    }
  };

  const handleAddNote = async () => {
    if (!newNote.trim() || !selectedSpace) return;
    const noteData = {
      floor: activeFloor,
      space: selectedSpace,
      content: newNote,
      timestamp: new Date().toLocaleString(),
      createdAt: serverTimestamp(),
      status: 'pending',
      authorEmail: user?.email || null,
      authorId: 'public'
    };
    try {
      await addDoc(collection(db, 'notes'), noteData);
      setNewNote('');
      if (selectedSpace) {
        localStorage.removeItem(`note_draft_${activeFloor}_${selectedSpace}`);
      }
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
      const sourceReqs = getRequirementsForSpace(requirements, selectedSpace);

      const sourceNotes = notes.filter(n => n.space === selectedSpace && n.floor === activeFloor && n.status === 'pending');

      if (sourceNotes.length === 0) {
         setNotification({ message: '無新會議紀錄可整合', type: 'error' });
         setIsCleaning(false);
         setTimeout(() => setNotification(null), 2000);
         return;
      }

      const aiResult = await analyzeNotesToRequirements(
        sourceReqs.length ? sourceReqs : [{ title: selectedSpace, points: [] }], 
        sourceNotes,
        selectedSpace
      );
      
      if (aiResult && aiResult.requirements) {
        setPendingAiResult({
          requirements: aiResult.requirements,
          summary: aiResult.summary || { added: [], updated: [], merged: [] },
          sourceNotes: sourceNotes
        });
        
        // Initialize selectedProposedPoints with all points from the AI result
        const initialSelected: Record<string, string[]> = {};
        aiResult.requirements.forEach((req: any) => {
          initialSelected[req.title] = req.points || [];
        });
        setSelectedProposedPoints(initialSelected);
      }
    } catch (e: any) {
      console.error(e);
      setNotification({ message: e.message || '分析失敗', type: 'error' });
    } finally {
      setIsCleaning(false);
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Firestore Sync: Checklist
  useEffect(() => {
    const seedChecklistInfo = async () => {
      if (localStorage.getItem('checklist_seeded')) return;
      try {
        const snapshot = await getDocs(query(collection(db, 'checklist'), limit(1)));
        if (snapshot.empty) {
          const initials = ["病房走廊扶手位置與高度", "浴廁防滑地磚選樣", "讀取燈控制面板位置", "日光室儲物櫃層板間距", "護理站藥櫃抽屜標示", "保護室軟墊拼接縫隙"];
          const batch = writeBatch(db);
          initials.forEach((text, i) => {
            batch.set(doc(collection(db, 'checklist')), { text, checked: false, order: i, createdAt: serverTimestamp() });
          });
          await batch.commit();
        }
        localStorage.setItem('checklist_seeded', 'true');
      } catch (err) {
        console.error("Checklist seed failed:", err);
      }
    };
    seedChecklistInfo();

    const q = query(collection(db, 'checklist'), orderBy('order', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ChecklistItem[];
      if (data.length > 0) setChecklist(data);
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
          space: selectedSpace,
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
            batch.set(ref, { ...r, space: selectedSpace, updatedAt: serverTimestamp() });
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
              space: selectedSpace,
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
      // Use pending notes for the current space if any, otherwise all notes for current space
      const sourceNotes = notes.filter(n => n.status === 'pending' && n.space === selectedSpace);
      const analysisInput = sourceNotes.length > 0 ? sourceNotes : notes.filter(n => n.space === selectedSpace);
      
      const sourceReqs = getRequirementsForSpace(requirements, selectedSpace);
      
      const aiResult = await analyzeNotesToRequirements(
        sourceReqs, 
        analysisInput, 
        selectedSpace || 'General'
      );
      
      if (aiResult && aiResult.requirements) {
        setPendingAiResult({
          requirements: aiResult.requirements,
          summary: aiResult.summary || { added: [], updated: [], merged: [] },
          sourceNotes: analysisInput
        });
        
        // Initialize selectedProposedPoints with all points from the AI result
        const initialSelected: Record<string, string[]> = {};
        aiResult.requirements.forEach((req: any) => {
          initialSelected[req.title] = req.points || [];
        });
        setSelectedProposedPoints(initialSelected);
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      setNotification({ message: 'AI 分析失敗，請稍後再試。', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    setIsLoginLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      setShowLoginModal(false);
      setNotification({ message: '登入成功！', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err: any) {
      console.error(err);
      setNotification({ message: '登入失敗，請檢查帳號密碼', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setNotification({ message: '已登出', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error(err);
    }
  };

  const getOrCreateFolder = async (token: string, floorName: string, spaceName: string) => {
    const rootFolderName = "B棟3F、5F改建工程細部設計需求照片";
    
    const findOrCreateSubfolder = async (name: string, parentId?: string) => {
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
      
      const createData = await createRes.json();
      const folderId = createData.id;
      
      try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}/permissions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            role: 'reader',
            type: 'anyone'
          })
        });
      } catch (err) {
        console.warn(`Could not set permissions for folder '${name}':`, err);
      }
      
      return folderId;
    };

    try {
      // 第一層：B棟3F、5F改建工程細部設計需求照片
      const rootFolderId = await findOrCreateSubfolder(rootFolderName);
      // 第二層：B棟3F 或 B棟5F 等
      const floorFolderId = await findOrCreateSubfolder(floorName, rootFolderId);
      // 第三層：具體空間名稱 (如：護理站)
      const spaceFolderId = await findOrCreateSubfolder(spaceName, floorFolderId);
      
      return spaceFolderId;
    } catch (err) {
      console.error("Failed to solve nested folder creation/search on Drive:", err);
      throw err;
    }
  };

  const initiateGoogleOAuth = (onSuccessCallback?: (token: string) => void) => {
    setIsDriveConnecting(true);

    if (googleAuthMethod === 'firebase') {
      setNotification({ message: '正在開啟 Google 安全彈出視窗以授權雲端硬碟權限...', type: 'ai' });
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      provider.addScope('https://www.googleapis.com/auth/drive.readonly');
      provider.addScope('https://www.googleapis.com/auth/documents');

      signInWithPopup(auth, provider).then((result) => {
        setIsDriveConnecting(false);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        if (credential?.accessToken) {
          const token = credential.accessToken;
          const expiresAt = Date.now() + 3600 * 1000;
          
          setDriveAccessToken(token);
          localStorage.setItem('drive_access_token_v4', token);
          localStorage.setItem('drive_token_expires_at_v4', expiresAt.toString());
          
          setNotification({ message: '成功連結 Google 雲端硬碟！熱連線已就緒。', type: 'success' });
          setTimeout(() => setNotification(null), 3000);
          
          if (onSuccessCallback) {
            onSuccessCallback(token);
          }
        } else {
          setNotification({ message: '驗證失敗：無法登入取得雲端硬碟存取權杖。', type: 'error' });
          setTimeout(() => setNotification(null), 5000);
        }
      }).catch((error: any) => {
        setIsDriveConnecting(false);
        console.error("Firebase auth popup failed:", error);
        setAuthErrorCode(error.code || 'unknown');
        setShowAuthErrorModal(true);
        if (error.code === 'auth/popup-blocked') {
          setNotification({ message: '授權視窗已被瀏覽器封鎖！請查看彈出的疑難排解助手，或更換瀏覽器後重試。', type: 'error' });
        } else if (error.code === 'auth/cancelled-popup-request') {
          setNotification({ message: '授權請求已被取消。已為您開啟疑難排解助手。', type: 'error' });
        } else if (error.code === 'auth/popup-closed-by-user') {
          setNotification({ 
            message: '授權視窗已被關閉。已為您開啟疑難排解助手，提供您「新分頁開啟」與「手動貼上權杖」等備用連結方案！', 
            type: 'error' 
          });
        } else {
          setNotification({ message: `連結雲端失敗: ${error.message || '請確認網路與 Firebase 登入設定。'}`, type: 'error' });
        }
        setTimeout(() => setNotification(null), 6000);
      });
      return;
    }

    // GSI Client direct authentication
    setNotification({ message: '正在載入 Google 網頁驗證服務 (GIS)...', type: 'ai' });
    try {
      if (typeof window !== 'undefined' && (window as any).google?.accounts?.oauth2) {
        const client = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: googleClientId.trim(),
          scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/documents',
          callback: (tokenResponse: any) => {
            setIsDriveConnecting(false);
            if (tokenResponse && tokenResponse.access_token) {
              const token = tokenResponse.access_token;
              const expiresAt = Date.now() + (Number(tokenResponse.expires_in) * 1000);
              
              setDriveAccessToken(token);
              localStorage.setItem('drive_access_token_v4', token);
              localStorage.setItem('drive_token_expires_at_v4', expiresAt.toString());
              
              setNotification({ message: '成功連結 Google 雲端硬碟！熱連線已就緒。', type: 'success' });
              setTimeout(() => setNotification(null), 3000);
              
              if (onSuccessCallback) {
                onSuccessCallback(token);
              }
            } else {
              setNotification({ message: '驗證失敗：未取得存取權杖。請確認 Client ID 與 JavaScript 來源設定。', type: 'error' });
              setTimeout(() => setNotification(null), 5000);
            }
          },
          error_callback: (err: any) => {
            setIsDriveConnecting(false);
            console.error("GIS Error:", err);
            setNotification({ message: `驗證失敗: ${err.message || '請檢查 Client ID 或當前來源網址。'}`, type: 'error' });
            setTimeout(() => setNotification(null), 5000);
          }
        });
        client.requestAccessToken();
      } else {
        // Dynamic loading fallback
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => {
          initiateGoogleOAuth(onSuccessCallback);
        };
        script.onerror = () => {
          setIsDriveConnecting(false);
          setNotification({ message: '載入 Google Identity SDK 失敗，請重試或切換至 Firebase 驗證模式。', type: 'error' });
          setTimeout(() => setNotification(null), 5000);
        };
        document.body.appendChild(script);
      }
    } catch (e: any) {
      console.error(e);
      setIsDriveConnecting(false);
      setNotification({ message: `啟動 Google 驗證失敗: ${e.message || '未知錯誤'}`, type: 'error' });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  const handleConnectGoogleDrive = async () => {
    initiateGoogleOAuth();
  };

  const proceedWithUpload = async (token: string, files: File[]) => {
    setIsUploadingPhoto(true);
    setNotification({ message: '正在建立雲端硬碟照片目錄...', type: 'ai' });

    try {
      let floorFolderName = activeMap?.name || activeFloor || "其他樓層";
      if (floorFolderName.includes('B3F') || floorFolderName.includes('3F')) {
        floorFolderName = "B棟3F";
      } else if (floorFolderName.includes('B5F') || floorFolderName.includes('5F')) {
        floorFolderName = "B棟5F";
      }
      
      const folderId = await getOrCreateFolder(token, floorFolderName, selectedSpace);

      const options = {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 2048,
        useWebWorker: true
      };

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setNotification({ message: `正在優化並上傳照片 (${i + 1}/${files.length})...`, type: 'ai' });

        let fileToUpload: File | Blob = file;
        try {
          fileToUpload = await imageCompression(file, options);
        } catch (e) {
          console.warn("Compression skipped:", e);
        }

        const filename = `${selectedSpace}_${new Date().toISOString().replace(/[:.]/g, '-')}_${i}.${file.name.split('.').pop() || 'jpg'}`;

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

        const mediaResponse = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': file.type
          },
          body: fileToUpload
        });

        if (!mediaResponse.ok) {
          const errText = await mediaResponse.text();
          throw new Error(`上傳照片內容失敗: ${errText}`);
        }

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

        const publicUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1280`;

        await addDoc(collection(db, 'photos'), {
          space: selectedSpace,
          url: publicUrl,
          driveFileId: fileId,
          createdAt: serverTimestamp(),
          authorId: user?.uid || 'guest'
        });
      }

      setNotification({ message: `成功上傳 ${files.length} 張照片至 Google Drive！`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err: any) {
      console.error(err);
      setNotification({ message: `照片上傳失敗: ${err.message || '未知錯誤'}`, type: 'error' });
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) {
        photoInputRef.current.value = '';
      }
    }
  };

  const handlePhotoUpload = async (
    event: React.ChangeEvent<HTMLInputElement> | ClipboardEvent | null,
    filesOverride?: File[]
  ) => {
    let files: FileList | File[] | null = filesOverride || null;
    
    if (!files && event) {
      if (event instanceof ClipboardEvent) {
        const items = event.clipboardData?.items;
        if (!items) return;
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) imageFiles.push(file);
          }
        }
        if (imageFiles.length === 0) return;
        files = imageFiles;
      } else {
        files = event.target.files;
      }
    }

    if (!files || files.length === 0 || !selectedSpace) return;

    const filesArray = Array.from(files);

    if (!driveAccessToken) {
      setNotification({ message: '提示：照片將直接上傳至雲端。正在自動開啟 Google 驗證...', type: 'ai' });
      initiateGoogleOAuth((newToken) => {
        proceedWithUpload(newToken, filesArray);
      });
      return;
    }
    
    await proceedWithUpload(driveAccessToken, filesArray);
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!selectedSpace) return;
      
      const items = e.clipboardData?.items;
      if (!items) return;

      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          hasImage = true;
          break;
        }
      }

      if (hasImage) {
        e.preventDefault();
        handlePhotoUpload(e);
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [selectedSpace, user, driveAccessToken]);

  const handleDeletePhoto = async (id: string) => {
    if (!user) return;
    const confirmed = window.confirm("確定要刪除這張照片嗎？");
    if (!confirmed) return;

    try {
      const photoDoc = spacePhotos.find(p => p.id === id);
      if (photoDoc && photoDoc.driveFileId && driveAccessToken) {
        try {
          await fetch(`https://www.googleapis.com/drive/v3/files/${photoDoc.driveFileId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${driveAccessToken}`
            }
          });
          console.log("Deleted from Google Drive:", photoDoc.driveFileId);
        } catch (driveErr) {
          console.error("Failed to delete from Google Drive:", driveErr);
        }
      }

      await deleteDoc(doc(db, 'photos', id));
      setNotification({ message: '照片已刪除', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error(err);
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
      const newStatus = currentStatus === 'confirmed' ? 'pending' : 'confirmed';
      await updateDoc(noteRef, { status: newStatus });
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
    const oldTopic = customTopics.find(t => t.id === id);
    if (!oldTopic) return;
    const oldName = oldTopic.name;
    const newName = topicEditName.trim();

    try {
      await updateDoc(doc(db, 'topics', id), { name: newName });
      
      // Update requirements linked to this space
      const reqsQ = query(collection(db, 'requirements'), where('space', '==', oldName));
      const reqsSnapshot = await getDocs(reqsQ);
      
      const batch = writeBatch(db);
      if (!reqsSnapshot.empty) {
        reqsSnapshot.docs.forEach(d => {
          batch.update(d.ref, { space: newName });
        });
      }

      // Also update notes linked to this space to avoid losing history linkage
      const notesQ = query(collection(db, 'notes'), where('space', '==', oldName));
      const notesSnapshot = await getDocs(notesQ);
      if (!notesSnapshot.empty) {
        notesSnapshot.docs.forEach(d => {
          batch.update(d.ref, { space: newName });
        });
      }

      await batch.commit();

      if (selectedSpace === oldName) setSelectedSpace(newName);

      setEditingTopicId(null);
      setNotification({ message: '空間名稱及相關數據已更新', type: 'success' });
      setTimeout(() => setNotification(null), 2000);
    } catch (err) {
      console.error(err);
      setNotification({ message: '更新失敗', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const handleDeleteTopic = (id: string, name: string) => {
    setDeleteConfirm({ id, name, type: 'topic' });
  };

  const handleBatchCopySpecs = async () => {
    if (copySpecsSelectedReqs.length === 0 || copySpecsSelectedTargets.length === 0) return;
    
    setIsCopyingSpecs(true);
    setNotification({ message: '正在複製規範...', type: 'ai' });

    try {
      const batch = writeBatch(db);
      
      // Get the source requirements
      const selectedReqsData = requirements.filter(r => copySpecsSelectedReqs.includes(r.id));
      
      for (const targetSpace of copySpecsSelectedTargets) {
        for (const req of selectedReqsData) {
          const newId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const ref = doc(db, 'requirements', newId);
          batch.set(ref, {
            space: targetSpace,
            title: req.title,
            points: req.points,
            createdAt: serverTimestamp()
          });
        }
      }

      await batch.commit();
      setNotification({ message: `成功複製至 ${copySpecsSelectedTargets.length} 個空間`, type: 'success' });
      setShowCopySpecsModal(false);
      setCopySpecsSelectedReqs([]);
      setCopySpecsSelectedTargets([]);
    } catch (err) {
      console.error(err);
      setNotification({ message: '複製失敗', type: 'error' });
    } finally {
      setIsCopyingSpecs(false);
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const performDeleteTopic = async (id: string, name: string) => {
    try {
      if (selectedSpace === name) setSelectedSpace(null);
      await deleteDoc(doc(db, 'topics', id));
      
      const notesQ = query(collection(db, 'notes'), where('space', '==', name));
      const notesSnapshot = await getDocs(notesQ);
      if (!notesSnapshot.empty) {
        const batch = writeBatch(db);
        notesSnapshot.docs.forEach(n => {
          batch.delete(n.ref);
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
      await addDoc(collection(db, 'topics'), {
        name: newName,
        createdAt: serverTimestamp(),
        creatorId: 'public',
        floorId: topic.floorId,
        order: (customTopics[customTopics.length - 1]?.order || 0) + 1,
        isDefault: false,
        type: topic.type || 'space'
      });

      // Copy requirements ONLY
      const reqsQ = query(collection(db, 'requirements'), where('space', '==', topic.name));
      const reqsSnapshot = await getDocs(reqsQ);
      
      if (!reqsSnapshot.empty) {
        const batch = writeBatch(db);
        reqsSnapshot.docs.forEach((reqDoc) => {
          const data = reqDoc.data();
          const newReqRef = doc(collection(db, 'requirements'));
          batch.set(newReqRef, {
            ...data,
            space: newName,
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }

      setNotification({ message: `已複製空間「${newName}」並同步細部規範項目`, type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error(err);
      setNotification({ message: '複製失敗', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
    }
  };

  const handleReorderTopics = async (newOrder: Topic[]) => {
    if (!user) return;
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

  const handleAddTopic = async (type: 'space' | 'trade') => {
    const trimmedName = newTopicName.trim();
    if (!trimmedName) return;

    // Check if this name already exists in THIS floor or is a global default
    const isDuplicate = customTopics.some(t => 
      t.name === trimmedName && (t.isDefault || t.floorId === activeFloor || t.floorId === 'global')
    );

    if (isDuplicate) {
      setNotification({ message: '此內容已存在', type: 'error' });
      setTimeout(() => setNotification(null), 2000);
      return;
    }

    try {
      await addDoc(collection(db, 'topics'), {
        name: trimmedName,
        type,
        createdAt: serverTimestamp(),
        creatorId: 'public',
        floorId: type === 'space' ? activeFloor : 'global',
        order: (customTopics[customTopics.length - 1]?.order || 0) + 1,
        isDefault: false
      });
      setNewTopicName('');
      setShowAddTopic({ open: false, type: 'space' });
      setNotification({ message: `「${trimmedName}」已新增`, type: 'success' });
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

  const handleSaveGoogleSettings = () => {
    if (googleClientId.trim()) {
      localStorage.setItem('google_client_id', googleClientId.trim());
      setNotification({ message: 'Google Client ID 雲端設定已儲存！', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    }
  };

  const handleSaveManualToken = () => {
    if (!manualToken.trim()) return;
    const token = manualToken.trim();
    const expiresAt = Date.now() + 3600 * 1000; // 1 hour expiration
    setDriveAccessToken(token);
    localStorage.setItem('drive_access_token_v4', token);
    localStorage.setItem('drive_token_expires_at_v4', expiresAt.toString());
    setShowAuthErrorModal(false);
    setManualToken('');
    setNotification({ message: '手動 Cloud Access Token 熱連結成功！', type: 'success' });
    setTimeout(() => setNotification(null), 3000);
  };

  const handleAiQuery = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatInput('');
    setIsAiLoading(true);

    try {
      const aiRes = await askAiAssistant(userMsg);
      setChatMessages(prev => [...prev, { role: 'assistant', content: aiRes }]);
    } catch (err: any) {
      console.error(err);
      setChatMessages(prev => [...prev, { role: 'assistant', content: `**發生錯誤**: ${err.message || '無法取得 AI 回覆'}` }]);
      setNotification({ message: err.message || 'AI 請求失敗', type: 'error' });
      setTimeout(() => setNotification(null), 3000);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleConfirmAiAnalysis = async () => {
    if (!pendingAiResult || !selectedSpace) return;
    setIsCleaning(true);
    try {
      const batch = writeBatch(db);
      
      // Delete all existing local requirements for this space to avoid duplication
      // because the AI returns a completely merged and re-categorized list.
      const existingReqsForSpace = requirements.filter(r => r.space === selectedSpace && !r.id.startsWith('default-') && r.id !== 'new');
      for (const req of existingReqsForSpace) {
        batch.delete(doc(db, 'requirements', req.id));
      }
      
      // Add the newly categorized and merged requirements
      for (const title of Object.keys(selectedProposedPoints)) {
        const points = selectedProposedPoints[title];
        if (points.length === 0) continue;

        const newRef = doc(collection(db, 'requirements'));
        batch.set(newRef, { 
          title: title, 
          points: points, 
          space: selectedSpace,
          updatedAt: serverTimestamp() 
        });
      }

      pendingAiResult.sourceNotes.forEach(n => {
        batch.update(doc(db, 'notes', n.id), { status: 'confirmed', updatedAt: serverTimestamp() });
      });
      await batch.commit();

      setPendingAiResult(null);
      setNotification({ message: '工程規範已根據篩選結果更新！', type: 'success' });
      setTimeout(() => setNotification(null), 3000);
    } catch (err) {
      console.error(err);
      setNotification({ message: '應用變更失敗', type: 'error' });
    } finally {
      setIsCleaning(false);
    }
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
            <div>
              <h1 className="font-black text-lg tracking-tight text-slate-900 leading-tight">龍泉分院</h1>
              <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest leading-none">B棟3F、5F改建工程討論平台</p>
            </div>
          </div>
          <button onClick={toggleSidebar} className="p-2 hover:bg-black/5 rounded-lg text-slate-500">
            {sidebarOpen ? <Menu size={20} /> : <ChevronRight size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4 overflow-y-auto custom-scrollbar">
          {user && !isNursingDept && (
             <div className="mb-4">
                <button 
                  onClick={() => setIsSidebarEditing(!isSidebarEditing)}
                  className={`w-full flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-bold transition-all border ${isSidebarEditing ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100'}`}
                >
                  <Edit size={14} />
                  {sidebarOpen && <span>{isSidebarEditing ? '完成編輯並鎖定' : '編輯側欄項目'}</span>}
                </button>
             </div>
          )}

          <AnimatePresence mode="wait">
            {sidebarMode === 'root' && (
              <motion.div
                key="root"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-3"
              >
                <div className="mb-4">
                   <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-4 mb-2">空間總覽</h3>
                   {projectMaps.map(map => (
                     <NavItem 
                       key={map.id}
                       icon={<MapIcon size={20} />} 
                       label={map.name} 
                       active={activeFloor === map.id} 
                       onClick={() => { setActiveFloor(map.id); setSidebarMode('space'); if (activeMainTab === 'report') setActiveMainTab('discussion'); }}
                       collapsed={!sidebarOpen}
                       onDelete={isSidebarEditing && user && !isNursingDept ? () => handleDeleteFloor(map.id, map.name) : undefined}
                       user={isSidebarEditing && user && !isNursingDept ? user : null}
                       onDoubleClick={isSidebarEditing && user && !isNursingDept ? () => { setEditingFloorId(map.id); setFloorEditName(map.name); } : undefined}
                       isEditing={editingFloorId === map.id}
                       editValue={floorEditName}
                       onEditChange={setFloorEditName}
                       onEditSubmit={() => handleUpdateFloor(map.id)}
                       onEditCancel={() => setEditingFloorId(null)}
                     />
                   ))}

                   {user && !isNursingDept && (
                     <button 
                       onClick={() => setShowAddMapModal(true)}
                       className={`w-full flex items-center gap-3 p-3 rounded-xl text-slate-500 hover:bg-black/5 hover:text-blue-600 transition-all border border-dashed border-slate-300 mt-2 ${!sidebarOpen && 'justify-center'}`}
                     >
                       <Plus size={18} />
                       {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">新增配置圖</span>}
                     </button>
                   )}
                </div>
                
                <button 
                  onClick={() => { setSidebarMode('trade'); if (activeMainTab === 'report') setActiveMainTab('discussion'); }}
                  className={`w-full flex items-center gap-3 p-4 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md hover:border-blue-300 transition-all ${!sidebarOpen && 'justify-center'}`}
                >
                  <ClipboardList size={24} className="text-blue-500" />
                  {sidebarOpen && <span className="text-sm font-black text-slate-700 tracking-wider">分項工程</span>}
                </button>
              </motion.div>
            )}

            {sidebarMode === 'space' && (
              <motion.div
                key="space"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="mb-2">
                   <button onClick={() => setSidebarMode('root')} className={`w-full flex items-center gap-2 p-2 text-slate-500 hover:bg-black/5 rounded-lg text-xs font-bold transition-all mb-4 ${!sidebarOpen && 'justify-center'}`}>
                     <ChevronLeft size={16} />
                     {sidebarOpen && <span className="uppercase tracking-widest">回到主選單</span>}
                   </button>
                   <div className="flex items-center justify-between px-4 mb-2">
                      <h3 className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest ${!sidebarOpen && 'hidden'}`}>
                        {activeMap?.name}
                      </h3>
                   </div>

             {user && !isNursingDept && (
               <button 
                  onClick={() => setShowAddTopic({ open: !showAddTopic.open || showAddTopic.type !== 'space', type: 'space' })}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors mb-2 ${!sidebarOpen && 'justify-center'}`}
               >
                  <PlusCircle size={18} />
                  {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">新增設計空間</span>}
               </button>
             )}

             {sidebarOpen && showAddTopic.open && showAddTopic.type === 'space' && (
               <div className="mb-4 flex flex-col gap-2 px-4 py-3 bg-blue-50/50 rounded-xl border border-blue-100 mx-2">
                 <input 
                   autoFocus
                   type="text"
                   value={newTopicName}
                   onChange={(e) => setNewTopicName(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleAddTopic('space')}
                   placeholder="例如：會客室、配膳間..."
                   className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-all"
                 />
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setShowAddTopic({ open: false, type: 'space' })}
                     className="flex-1 py-1.5 text-xs text-slate-500 font-bold hover:bg-white rounded border border-slate-200"
                   >取消</button>
                   <button 
                     onClick={() => handleAddTopic('space')}
                     className="flex-1 py-1.5 bg-blue-500 text-white rounded text-xs font-bold shadow-sm"
                   >確認新增</button>
                 </div>
               </div>
             )}

             <Reorder.Group axis="y" values={customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === activeFloor || t.floorId === 'global'))} onReorder={handleReorderTopics} className="space-y-1">
                {customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === activeFloor || t.floorId === 'global')).map((topic) => (
                  <Reorder.Item key={topic.id} value={topic} dragListener={!!user && !isNursingDept && isSidebarEditing}>
               <NavItem 
                 key={topic.id}
                 icon={<Layout size={20} />} 
                 label={topic.name} 
                 active={selectedSpace === topic.name} 
                 onClick={() => { setSelectedSpace(topic.name); if (activeMainTab === 'report') setActiveMainTab('discussion'); }}
                 collapsed={!sidebarOpen}
                 
                  onDoubleClick={(isSidebarEditing && user && !isNursingDept && (!topic.isDefault || user)) ? () => { setEditingTopicId(topic.id); setTopicEditName(topic.name); } : undefined}
                 isEditing={editingTopicId === topic.id}
                 editValue={topicEditName}
                 onEditChange={setTopicEditName}
                 onEditSubmit={() => handleUpdateTopic(topic.id)}
                 onEditCancel={() => setEditingTopicId(null)}
                  onDelete={(isSidebarEditing && user && !isNursingDept && (!topic.isDefault || user)) ? () => handleDeleteTopic(topic.id, topic.name) : undefined}
                 onCopy={isSidebarEditing && user && !isNursingDept ? () => handleCopyTopic(topic) : undefined}
                 user={isSidebarEditing && user && !isNursingDept ? user : null}
                 isSortable={true}
               />
             </Reorder.Item>
           ))}
         </Reorder.Group>
          </div>
        </motion.div>
      )}

      {sidebarMode === 'trade' && (
        <motion.div
          key="trade"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-4"
        >
          <div className="mb-4">
             <button onClick={() => setSidebarMode('root')} className={`w-full flex items-center gap-2 p-2 text-slate-500 hover:bg-black/5 rounded-lg text-xs font-bold transition-all mb-4 ${!sidebarOpen && 'justify-center'}`}>
               <ChevronLeft size={16} />
               {sidebarOpen && <span className="uppercase tracking-widest">回到主選單</span>}
             </button>
             <div className="flex items-center justify-between px-4 mb-2">
                <h3 className={`text-[10px] font-bold text-slate-400 uppercase tracking-widest ${!sidebarOpen && 'hidden'}`}>分項工程</h3>
             </div>

             {user && !isNursingDept && (
               <button 
                  onClick={() => setShowAddTopic({ open: !showAddTopic.open || showAddTopic.type !== 'trade', type: 'trade' })}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors mb-2 ${!sidebarOpen && 'justify-center'}`}
               >
                  <PlusCircle size={18} />
                  {sidebarOpen && <span className="text-xs font-bold uppercase tracking-widest">新增分項工程</span>}
               </button>
             )}

             {sidebarOpen && showAddTopic.open && showAddTopic.type === 'trade' && (
               <div className="mb-4 flex flex-col gap-2 px-4 py-3 bg-blue-50/50 rounded-xl border border-blue-100 mx-2">
                 <input 
                   autoFocus
                   type="text"
                   value={newTopicName}
                   onChange={(e) => setNewTopicName(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && handleAddTopic('trade')}
                   placeholder="例如：空調工程、氣體工程..."
                   className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-all"
                 />
                 <div className="flex gap-2">
                   <button 
                     onClick={() => setShowAddTopic({ open: false, type: 'trade' })}
                     className="flex-1 py-1.5 text-xs text-slate-500 font-bold hover:bg-white rounded border border-slate-200"
                   >取消</button>
                   <button 
                     onClick={() => handleAddTopic('trade')}
                     className="flex-1 py-1.5 bg-blue-500 text-white rounded text-xs font-bold shadow-sm"
                   >確認新增</button>
                 </div>
               </div>
             )}

              <Reorder.Group axis="y" values={customTopics.filter(t => t.type === 'trade')} onReorder={handleReorderTopics} className="space-y-1">
                 {customTopics.filter(t => t.type === 'trade').map((topic) => (
                   <Reorder.Item key={topic.id} value={topic} dragListener={!!user && !isNursingDept && isSidebarEditing}>
                 <NavItem 
                   key={topic.id}
                   icon={<ClipboardList size={20} />} 
                   label={topic.name} 
                   active={selectedSpace === topic.name} 
                   onClick={() => { setSelectedSpace(topic.name); if (activeMainTab === 'report') setActiveMainTab('discussion'); }}
                   collapsed={!sidebarOpen}
                   user={isSidebarEditing && user && !isNursingDept ? user : null}
                   onDoubleClick={(isSidebarEditing && user && !isNursingDept && (!topic.isDefault || user)) ? () => { setEditingTopicId(topic.id); setTopicEditName(topic.name); } : undefined}
                   isEditing={editingTopicId === topic.id}
                   editValue={topicEditName}
                   onEditChange={setTopicEditName}
                   onEditSubmit={() => handleUpdateTopic(topic.id)}
                   onEditCancel={() => setEditingTopicId(null)}
                   onDelete={(isSidebarEditing && user && !isNursingDept && (!topic.isDefault || user)) ? () => handleDeleteTopic(topic.id, topic.name) : undefined}
                   onCopy={isSidebarEditing && user && !isNursingDept ? () => handleCopyTopic(topic) : undefined}
                   isSortable={true}
                 />
               </Reorder.Item>
             ))}
           </Reorder.Group>
          </div>
        </motion.div>
       )}
      </AnimatePresence>
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-4">
          {user?.email === 'jason2134@gmail.com' && (
            <button 
              onClick={() => { setActiveMainTab('report'); setSelectedSpace(null); setSidebarMode('root'); }}
              className={`w-full flex items-center gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-all ${!sidebarOpen && 'justify-center'}`}
            >
              <FileText size={18} />
              {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">需求彙整報表</span>}
            </button>
          )}
          
          <button 
            onClick={() => setShowApiModal(true)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${isApiKeySet ? 'bg-blue-500/10 text-blue-600 border border-blue-500/30' : 'bg-black/5 text-slate-500 border border-transparent hover:bg-black/10'} ${!sidebarOpen && 'justify-center'}`}
          >
            <Key size={18} />
            {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">{isApiKeySet ? 'API Key 已設定' : '設定 API Key'}</span>}
          </button>
          
          {user ? (
            <div className={`p-3 rounded-xl bg-blue-50 border border-blue-100 ${!sidebarOpen && 'flex justify-center'}`}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold group relative cursor-pointer" onClick={handleLogout}>
                   <UserIcon size={16} />
                   <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                     <LogOut size={14} />
                   </div>
                </div>
                {sidebarOpen && (
                  <div className="overflow-hidden flex-1">
                    <p className="text-xs font-bold truncate text-slate-900">{user.email}</p>
                    <button onClick={handleLogout} className="text-[10px] text-blue-600 font-bold uppercase tracking-widest hover:underline text-left block">登出帳號</button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button 
              onClick={() => setShowLoginModal(true)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700 transition-all ${!sidebarOpen && 'justify-center'}`}
            >
              <LogIn size={18} />
              {sidebarOpen && <span className="text-sm font-bold uppercase tracking-widest">登入協作模式</span>}
            </button>
          )}
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
             <div className="flex items-center gap-2 bg-white/50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm mr-4">
               <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden md:inline">顯示比例</span>
               <input 
                 type="range" 
                 min="0.5" max="1.5" step="0.1" 
                 value={viewScale} 
                 onChange={(e) => setViewScale(parseFloat(e.target.value))}
                 className="w-24 accent-blue-600"
               />
               <span className="text-[10px] font-bold text-blue-600 w-8">{Math.round(viewScale * 100)}%</span>
             </div>
          </div>
        </header>

        {/* Workspace */}
        <div className="flex-1 flex overflow-hidden relative bg-brand-bg">
          <div className="flex-1 flex flex-col absolute inset-0 overflow-hidden p-6 origin-top-left transition-transform" style={{ transform: `scale(${viewScale})`, width: `${(1 / viewScale) * 100}%`, height: `${(1 / viewScale) * 100}%` }}>
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
            {activeMainTab !== 'report' && (
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
                      onClick={() => setActiveMainTab('photos')}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                        activeMainTab === 'photos' 
                          ? 'bg-white text-blue-600 shadow-lg' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <ImageIcon size={16} />
                      空間現況/示意照片
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
                    <button 
                      onClick={() => setActiveMainTab('plan')}
                      className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all duration-300 ${
                        activeMainTab === 'plan' 
                          ? 'bg-white text-blue-600 shadow-lg' 
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <PenTool size={16} />
                      平面圖註記
                    </button>
                 </div>
                 
                 {activeMainTab === 'discussion' && selectedSpace && !isNursingDept && (
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
            )}

            {/* Main Content Pane */}
            <div className="flex-1 flex overflow-hidden gap-6 lg:gap-8">
              <div className="flex-1 glass-panel rounded-3xl overflow-hidden shadow-2xl border border-white/40 relative flex flex-col">
                {activeMainTab === 'report' ? (
                  <ReportView 
                    projectMaps={projectMaps} 
                    customTopics={customTopics} 
                    allRequirements={cachedAllRequirements || []} 
                    spacePhotos={spacePhotos}
                    driveAccessToken={driveAccessToken}
                    initiateGoogleOAuth={initiateGoogleOAuth}
                    setNotification={setNotification}
                  />
                ) : activeMainTab === 'map' ? (
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
                      <div className="h-full flex flex-col p-6 lg:p-8 space-y-8">
                        {/* Space Header */}
                        <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
                          <div>
                            <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest mb-1">
                              {activeMainTab === 'photos' ? '空間視覺參考' : activeMainTab === 'plan' ? '平面圖標註' : '空間細部規範'}
                            </h4>
                            <h3 className="text-3xl font-black text-slate-900 tracking-tight">{selectedSpace}</h3>
                          </div>
                          <div className="flex items-center gap-2">
                            {activeMainTab === 'discussion' && user && !isNursingDept && (
                              <button 
                                onClick={() => {
                                  // Pre-select all requirements of the current space
                                  const currentReqs = getRequirementsForSpace(requirements, selectedSpace);
                                  setCopySpecsSelectedReqs(currentReqs.map(r => r.id));
                                  setCopySpecsSelectedTargets([]);
                                  setShowCopySpecsModal(true);
                                }}
                                className="flex items-center gap-2 px-3 py-1.5 text-blue-600 hover:bg-blue-50 border border-blue-200 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all"
                              >
                                <Copy size={12} />
                                複製規範至其他空間
                              </button>
                            )}
                            <button 
                              onClick={() => setSelectedSpace(null)} 
                              className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-500 rounded-xl transition-colors lg:hidden"
                            >
                              <X size={20} />
                            </button>
                          </div>
                        </div>

                        {activeMainTab === 'photos' ? (
                          /* Space Photos Section */
                          <div className="flex-1 min-h-0 flex flex-col space-y-4">
                            <div className="flex items-center justify-between shrink-0">
                              <h4 className="text-base font-black text-slate-800 uppercase tracking-widest flex items-center gap-2">
                                <ImageIcon size={18} className="text-blue-500" /> 空間現況/示意照片
                              </h4>
                              {user && !isNursingDept && (
                                <div className="flex items-center gap-2">
                                  {driveAccessToken ? (
                                    <span className="text-[10px] text-green-600 bg-green-50 px-2.5 py-1.5 rounded-lg border border-green-200 font-black tracking-normal flex items-center gap-1 shrink-0">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                      已連結
                                    </span>
                                  ) : (
                                    <span className="text-[10px] text-slate-500 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 font-medium tracking-normal flex items-center gap-1 shrink-0" title="上傳照片時會自動引導登入驗證">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                                      雲端自動驗證
                                    </span>
                                  )}
                                  
                                  <button 
                                    onClick={() => photoInputRef.current?.click()}
                                    disabled={isUploadingPhoto || isDriveConnecting}
                                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95 disabled:opacity-50"
                                  >
                                    {isUploadingPhoto || isDriveConnecting ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                                    上傳照片
                                  </button>

                                  <button 
                                    onClick={() => { setActiveSettingsTab('gdrive'); setShowApiModal(true); }}
                                    className="p-2 bg-slate-100 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-200 transition-all shadow-sm flex items-center justify-center"
                                    title="設定 Google Drive Client ID"
                                  >
                                    <Settings size={14} />
                                  </button>
                                </div>
                              )}
                              <input 
                                type="file"
                                ref={photoInputRef}
                                hidden
                                multiple
                                accept="image/*"
                                onChange={handlePhotoUpload}
                              />
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                              {currentSpacePhotos.length > 0 ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 py-2">
                                  {currentSpacePhotos.map((photo) => (
                                    <div 
                                      key={photo.id} 
                                      onClick={() => setSelectedLightboxPhoto(photo.url)}
                                      className="relative group aspect-square rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shadow-sm transition-all hover:shadow-lg hover:scale-[1.02] cursor-zoom-in"
                                    >
                                      <img 
                                        src={photo.url} 
                                        alt="Space view" 
                                        className="w-full h-full object-cover"
                                        loading="lazy"
                                      />
                                      {user && !isNursingDept && (
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); handleDeletePhoto(photo.id); }}
                                          className="absolute top-2 right-2 p-1.5 bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg hover:bg-red-700"
                                        >
                                          <Trash2 size={12} />
                                        </button>
                                      )}
                                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-2 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                                        {new Date(photo.createdAt?.seconds * 1000).toLocaleDateString()}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="flex flex-col items-center justify-center p-20 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                                  <ImageIcon size={48} className="text-slate-300 mb-4 animate-bounce" />
                                  <p className="text-lg text-slate-400 font-bold font-sans">尚無空間照片</p>
                                  <p className="text-xs text-slate-400 mt-1 text-center max-w-sm">
                                    點擊上方按鈕，或「直接複製圖片並在此處按 <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono font-bold text-slate-500 shadow-sm">Ctrl + V</kbd> 貼上」即可上傳至雲端。
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : activeMainTab === 'plan' ? (
                          <AnnotationView 
                            floorId={activeFloor}
                            selectedSpace={selectedSpace}
                            projectMap={activeMap}
                            driveAccessToken={driveAccessToken}
                            initiateGoogleOAuth={initiateGoogleOAuth}
                            user={user}
                            setNotification={setNotification}
                          />
                        ) : (
                          /* Engineering Specs Section */
                          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
                            <div className="bg-blue-600/5 border border-blue-500/10 rounded-2xl p-6">
                              <div className="flex justify-between items-center mb-6 sticky top-0 bg-transparent backdrop-blur-sm pb-2 z-10">
                                <h4 className="text-base font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                  <ShieldAlert size={18} /> 設計規範明細
                                </h4>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {(() => {
                                  const filtered = getRequirementsForSpace(requirements, selectedSpace);

                                  if (filtered.length === 0) return <p className="text-slate-500 text-sm italic col-span-full text-center py-12">無特定規範，請點擊右側輸入討論細節</p>;

                                  return filtered.filter(k => k.points.length > 0).map((cat) => (
                                    <div key={cat.id} className="space-y-4 p-5 bg-white/60 rounded-2xl border border-blue-500/10 group shadow-sm hover:shadow-md transition-all">
                                      <div className="flex justify-between items-center">
                                        <h5 className="text-lg font-black text-blue-700 border-l-4 border-blue-500 pl-4 py-1 uppercase tracking-tight">
                                          {cat.title}
                                        </h5>
                                        {user && !isNursingDept && (
                                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <button 
                                              onClick={() => setEditingReq({ id: cat.id, title: cat.title, points: cat.points })}
                                              className="p-2 hover:bg-blue-100 text-blue-600 rounded-xl"
                                            >
                                              <Edit size={16} />
                                            </button>
                                            {!cat.id.startsWith('default-') && (
                                              <button 
                                                onClick={() => setDeleteConfirm({ id: cat.id, name: cat.title, type: 'requirement' })}
                                                className="p-2 hover:bg-red-100 text-red-600 rounded-xl"
                                              >
                                                <Trash2 size={16} />
                                              </button>
                                            )}
                                          </div>
                                        )}
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
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Persistent Right Sidebar for Discussion - Visible when space is selected */}
              {selectedSpace && activeMainTab !== 'plan' && activeMainTab !== 'map' && activeMainTab !== 'report' && (
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
                      onChange={(e) => handleNoteChange(e.target.value)}
                      placeholder={user ? "請描述空間需求：如插座與弱電配置、呼叫系統、設備機電與給排水需求，及櫥櫃水槽樣式。您可以用白話描述，AI 會協助潤飾..." : "請先登入後再提供建議"}
                      disabled={!user}
                      className={`w-full h-32 p-4 border border-slate-200 rounded-2xl text-base text-slate-900 focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 shadow-inner outline-none resize-none transition-all placeholder:text-slate-400 ${user ? 'bg-slate-50 text-slate-900' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                    />
                    <button 
                      onClick={handleAddNote}
                      disabled={!newNote.trim() || !user}
                      className="w-full py-4 bg-blue-600 text-white rounded-2xl font-black shadow-lg shadow-blue-500/20 hover:bg-blue-700 hover:shadow-blue-500/30 disabled:opacity-50 transition-all active:scale-[0.98] text-sm tracking-widest uppercase"
                    >
                      {user ? '送出討論內容' : '請登入提供討論建議'}
                    </button>
                  </div>

                  {/* History Timeline */}
                  <div className="flex-1 min-h-0 flex flex-col bg-white border border-slate-200 rounded-3xl p-6 shadow-xl shadow-slate-200/20 overflow-hidden">
                    <div className="flex items-center justify-between mb-4 shrink-0">
                      <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 px-1">
                        <RotateCcw size={16} /> 空間討論版
                      </h4>
                      {!showHistory && (
                        <button 
                          onClick={() => setShowHistory(true)}
                          className="text-[10px] font-bold px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-all flex items-center gap-1.5 uppercase tracking-widest"
                        >
                          <Search size={12} />
                          載入已歸檔歷史紀錄
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar relative px-1">
                      <div className="absolute left-6 top-0 bottom-0 w-px bg-slate-100 z-0" />
                      <div className="relative z-10">
                        <NotesArchived 
                          key={`${activeFloor}-${selectedSpace}`}
                          notes={notes.filter(n => n.space === selectedSpace && n.floor === activeFloor)}
                          onToggleStatus={handleToggleNoteStatus}
                          onDelete={handleDeleteNote}
                          onEdit={(note) => setEditingNote(note)}
                          currentUserEmail={user?.email}
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
        {showCopySpecsModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !isCopyingSpecs && setShowCopySpecsModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
               <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600 text-white">
                 <div>
                   <h3 className="text-xl font-black uppercase tracking-widest">複製空間規範</h3>
                   <p className="text-xs font-medium opacity-80 mt-1">從「{selectedSpace}」複製選定的分類至其他空間</p>
                 </div>
                 <button onClick={() => setShowCopySpecsModal(false)} className="p-2 hover:bg-white/10 rounded-xl"><X size={20} /></button>
               </div>
               
               <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                  {/* Select Categories */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">第一步：選擇要複製的分類 ({copySpecsSelectedReqs.length})</h4>
                      <button 
                        onClick={() => {
                          const currentReqs = getRequirementsForSpace(requirements, selectedSpace);
                          setCopySpecsSelectedReqs(currentReqs.map(r => r.id));
                        }}
                        className="text-[10px] text-blue-600 font-bold hover:underline"
                      >
                        全選
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {getRequirementsForSpace(requirements, selectedSpace).map((req) => (
                        <label key={req.id} className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all cursor-pointer ${copySpecsSelectedReqs.includes(req.id) ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-slate-50 opacity-60 hover:opacity-100'}`}>
                          <input 
                            type="checkbox"
                            className="w-5 h-5 rounded-lg border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={copySpecsSelectedReqs.includes(req.id)}
                            onChange={(e) => {
                              if (e.target.checked) setCopySpecsSelectedReqs(prev => [...prev, req.id]);
                              else setCopySpecsSelectedReqs(prev => prev.filter(id => id !== req.id));
                            }}
                          />
                          <span className="text-xs font-black text-slate-700 uppercase">{req.title}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Select Target Spaces */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">第二步：選擇目標空間 ({copySpecsSelectedTargets.length})</h4>
                      <button 
                        onClick={() => setCopySpecsSelectedTargets(customTopics.filter(t => t.name !== selectedSpace && (t.type === 'space' || !t.type)).map(t => t.name))}
                        className="text-[10px] text-blue-600 font-bold hover:underline"
                      >
                        全選所有空間
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                       {/* Maps/Floors also as potential targets? No, user said spaces */}
                      {customTopics.filter(t => t.name !== selectedSpace && (t.type === 'space' || !t.type)).map((topic) => (
                        <label key={topic.id} className={`flex items-center gap-2 p-3 rounded-xl border transition-all cursor-pointer ${copySpecsSelectedTargets.includes(topic.name) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-100 bg-white text-slate-400 hover:text-slate-600'}`}>
                          <input 
                            type="checkbox"
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={copySpecsSelectedTargets.includes(topic.name)}
                            onChange={(e) => {
                              if (e.target.checked) setCopySpecsSelectedTargets(prev => [...prev, topic.name]);
                              else setCopySpecsSelectedTargets(prev => prev.filter(name => name !== topic.name));
                            }}
                          />
                          <span className="text-[10px] font-bold truncate">{topic.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
               </div>

               <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                 <button 
                   onClick={() => setShowCopySpecsModal(false)}
                   className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all"
                 >
                   取消
                 </button>
                 <button 
                   onClick={handleBatchCopySpecs}
                   disabled={isCopyingSpecs || copySpecsSelectedReqs.length === 0 || copySpecsSelectedTargets.length === 0}
                   className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                 >
                   {isCopyingSpecs ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                   確認執行複製
                 </button>
               </div>
            </motion.div>
          </div>
        )}

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
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-panel rounded-2xl p-8 max-w-xl w-full shadow-2xl relative"
            >
              <button 
                onClick={() => setShowApiModal(false)}
                className="absolute top-4 right-4 text-slate-500 hover:text-slate-900"
              >
                <X size={20} />
              </button>
              
              <div className="flex border-b border-slate-200 mb-6">
                <button
                  onClick={() => setActiveSettingsTab('gemini')}
                  className={`flex-1 pb-3 text-sm font-bold uppercase tracking-widest text-center transition-all ${activeSettingsTab === 'gemini' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  AI 輔助設定
                </button>
                <button
                  onClick={() => setActiveSettingsTab('gdrive')}
                  className={`flex-1 pb-3 text-sm font-bold uppercase tracking-widest text-center transition-all ${activeSettingsTab === 'gdrive' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  Google 雲端儲存
                </button>
              </div>

              {activeSettingsTab === 'gemini' ? (
                <div>
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
                </div>
              ) : (
                <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2 custom-scrollbar">
                  <div>
                    <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2 mb-2">
                      <UploadCloud size={20} className="text-blue-500" /> Google Drive 雲端設定
                    </h3>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      本系統照片與影片將儲存於您的 Google 雲端硬碟。請在此選擇適合您的 **Google 授權驗證技術**：
                    </p>
                  </div>

                  {/* Auth method selection */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setGoogleAuthMethod('firebase');
                        localStorage.setItem('google_auth_method', 'firebase');
                        setNotification({ message: '已切換為：Firebase 安全彈出授權 (推薦)', type: 'success' });
                        setTimeout(() => setNotification(null), 2000);
                      }}
                      className={`text-left p-4 rounded-xl border text-xs transition-all relative overflow-hidden flex flex-col justify-between ${
                        googleAuthMethod === 'firebase'
                          ? 'border-blue-500 bg-blue-50/40 rin-1 ring-blue-500 shadow-sm'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      {googleAuthMethod === 'firebase' && (
                        <span className="absolute top-0 right-0 bg-blue-500 text-white text-[9px] px-2 py-0.5 rounded-bl font-black">
                          推薦使用
                        </span>
                      )}
                      <div>
                        <div className="font-extrabold text-slate-800 mb-1 flex items-center gap-1 text-[13px]">
                          <span>Firebase 彈出授權</span>
                        </div>
                        <p className="text-slate-500 leading-relaxed text-[11px]">
                          ⭐ **推薦**：自動經由安全伺服器代理，**無任何網域限制**。不論是預覽網址、隨機分配的測試網址、還是本地主機，都不會出現授權錯誤，一鍵立即使用！
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setGoogleAuthMethod('gsi');
                        localStorage.setItem('google_auth_method', 'gsi');
                        setNotification({ message: '已切換為：自訂 Client ID 直接授權', type: 'success' });
                        setTimeout(() => setNotification(null), 2000);
                      }}
                      className={`text-left p-4 rounded-xl border text-xs transition-all flex flex-col justify-between ${
                        googleAuthMethod === 'gsi'
                          ? 'border-blue-500 bg-blue-50/40 rin-1 ring-blue-500 shadow-sm'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <div className="font-extrabold text-slate-800 mb-1 flex items-center gap-1 text-[13px]">
                          <span>自訂 Client ID 驗證</span>
                        </div>
                        <p className="text-slate-500 leading-relaxed text-[11px]">
                          使用您專屬 Google Cloud Console 的 Client ID，在網頁直接載入 Google 驗證。**必須手動向 Google 註冊當前網址為信任來源。**
                        </p>
                      </div>
                    </button>
                  </div>

                  {googleAuthMethod === 'gsi' ? (
                    <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="bg-amber-50 border border-amber-200 p-3 rounded-lg text-[11px] text-amber-800 leading-relaxed font-medium">
                        ⚠️ **重要提醒：** 當前為「自訂 Client ID」模式。若您的 Google Cloud Console 的 Javascript 授權來源中沒有加入本站目前的網址，登入時 Google 將會封鎖存取並顯示 `origin_mismatch` 錯誤（如您遭遇的 error 400）。若要快速排查或懶得設定，請按上方切換為 **「Firebase 彈出授權」** 便可直接使用！
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest flex justify-between">
                          <span>Google OAuth Client ID</span>
                          <span className="text-[10px] text-blue-500 cursor-pointer hover:underline" onClick={() => {
                            setGoogleClientId('501431628979-jecrmd9k54aqg96q7nj9qlblmhs34lm7.apps.googleusercontent.com');
                            localStorage.setItem('google_client_id', '501431628979-jecrmd9k54aqg96q7nj9qlblmhs34lm7.apps.googleusercontent.com');
                          }}>重設為預設 ID</span>
                        </label>
                        <input 
                          type="text"
                          value={googleClientId}
                          onChange={(e) => setGoogleClientId(e.target.value)}
                          placeholder="在此貼上您的 Google Client ID"
                          className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-700 outline-none focus:border-blue-500 transition-all font-mono"
                        />
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={handleSaveGoogleSettings}
                          className="flex-1 py-3 bg-slate-900 text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-slate-800 transition-all"
                        >
                          儲存 Client ID 設定
                        </button>
                        <button 
                          onClick={handleConnectGoogleDrive}
                          disabled={isDriveConnecting}
                          className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {isDriveConnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                          測試/開啟授權連結
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div className="bg-green-50 border border-green-200 p-3 rounded-lg text-[11px] text-green-800 leading-relaxed font-bold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0"></span>
                        已選擇免設定「Firebase 彈出授權」模式，此模式最穩健，不受任何 URL 或 Origin 網域變動限制！
                      </div>

                      <button 
                        onClick={handleConnectGoogleDrive}
                        disabled={isDriveConnecting}
                        className="w-full py-3.5 bg-blue-600 text-white font-bold rounded-xl text-xs uppercase tracking-widest hover:bg-blue-700 transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-md active:scale-95"
                      >
                        {isDriveConnecting ? <Loader2 size={12} className="animate-spin" /> : null}
                        測試/開啟 Firebase 授權連結
                      </button>
                    </div>
                  )}

                  {/* Connection Status Indicator */}
                  <div className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-xl">
                    <span className="text-xs font-black text-slate-700 uppercase tracking-wider">目前雲端狀態</span>
                    {driveAccessToken ? (
                      <span className="text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-lg border border-green-200 font-bold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        已授權 (可直接上傳照片)
                      </span>
                    ) : (
                      <span className="text-xs text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                        上傳時自動引導登入並傳送
                      </span>
                    )}
                  </div>

                  {/* Step-by-step user guide */}
                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-widest mb-3 flex items-center gap-1 text-blue-600">
                      💡 如何取得並使用我的 Client ID？
                    </h4>
                    <ul className="text-xs text-slate-500 space-y-2 leading-relaxed">
                      <li>
                        1. 前往 <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5 font-bold">Google Cloud Console ↗</a> 建立或選擇專案。
                      </li>
                      <li>
                        2. 於首頁搜尋列搜尋 <strong>Google Drive API</strong> 並點擊「啟用」。
                      </li>
                      <li>
                        3. 回到「API 和服務」的「憑證」中，點選「建立憑證」並選擇 <strong>OAuth 用戶端 ID</strong>（應用程式類型請選 <strong>Web 應用程式</strong>）。
                      </li>
                      <li>
                        4. ⚠️ **使用 GIS 模式最重要！** 請在「已授權的 JavaScript 來源」中加入本網域：
                        <div className="flex items-center gap-2 mt-1 bg-slate-100 p-2 rounded-lg text-[11px] font-mono text-slate-700 select-all border border-slate-200 justify-between">
                          <span>{typeof window !== 'undefined' ? window.location.origin : 'https://...'}</span>
                          <button 
                            type="button"
                            onClick={() => {
                              if (typeof navigator !== 'undefined') {
                                navigator.clipboard.writeText(window.location.origin);
                                setNotification({ message: '已複製當前網頁來源網址！', type: 'success' });
                                setTimeout(() => setNotification(null), 2000);
                              }
                            }}
                            className="bg-white hover:bg-slate-50 text-[10px] text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded font-sans"
                          >
                            複製
                          </button>
                        </div>
                      </li>
                      <li>
                        5. 建立完成後複製產生的 Client ID 貼到上方的輸入框中，點擊<strong>儲存 Client ID 設定</strong>即可！
                      </li>
                    </ul>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}

        {pendingAiResult && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setPendingAiResult(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-blue-600">
                <div className="flex items-center gap-3 text-white">
                  <Sparkles size={24} />
                  <h3 className="text-2xl font-black tracking-tight uppercase">AI 彙整結果確認</h3>
                </div>
                <button onClick={() => setPendingAiResult(null)} className="p-2 hover:bg-white/10 text-white rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8">
                <div className="bg-blue-50 border border-blue-100 p-4 rounded-2xl flex gap-3 text-blue-700">
                  <Info size={20} className="shrink-0 mt-0.5" />
                  <p className="text-sm font-medium">請勾選您希望套用到工程規範中的項目。AI 已自動去重並優化描述。</p>
                </div>

                <div className="space-y-6">
                  {pendingAiResult.requirements.filter(r => r.points && r.points.length > 0).map((req, ridx) => (
                    <div key={ridx} className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest">{req.title}</h4>
                        <div className="flex gap-4">
                          <button 
                            onClick={() => setSelectedProposedPoints(prev => ({ ...prev, [req.title]: req.points }))}
                            className="text-[10px] text-blue-600 font-bold hover:underline"
                          >全選</button>
                          <button 
                            onClick={() => setSelectedProposedPoints(prev => ({ ...prev, [req.title]: [] }))}
                            className="text-[10px] text-slate-400 font-bold hover:underline"
                          >全不選</button>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        {req.points.map((point: string, pidx: number) => {
                          const isSelected = selectedProposedPoints[req.title]?.includes(point);
                          return (
                            <label key={pidx} className={`group flex items-start gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer ${isSelected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white opacity-60 hover:opacity-100'}`}>
                              <div className="mt-1">
                                <input 
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedProposedPoints(prev => ({
                                        ...prev,
                                        [req.title]: [...(prev[req.title] || []), point]
                                      }));
                                    } else {
                                      setSelectedProposedPoints(prev => ({
                                        ...prev,
                                        [req.title]: (prev[req.title] || []).filter(p => p !== point)
                                      }));
                                    }
                                  }}
                                  className="w-5 h-5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                              </div>
                              <span className={`text-base leading-relaxed ${isSelected ? 'text-slate-900 font-medium' : 'text-slate-400 font-normal'}`}>
                                {point}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="h-px bg-slate-100 my-8" />

                <section className="space-y-4">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">異動摘要報告</h4>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-emerald-700 text-xs font-black uppercase tracking-widest">新增與增補項目</div>
                        <div className="text-emerald-700 font-bold bg-emerald-200/50 px-2.5 py-0.5 rounded-full text-xs">{pendingAiResult.summary.added.length} 筆</div>
                      </div>
                      <ul className="list-disc list-inside space-y-1.5">
                         {pendingAiResult.summary.added.length > 0 ? pendingAiResult.summary.added.map((item: string, i: number) => (
                           <li key={i} className="text-sm text-emerald-800">{item}</li>
                         )) : <li className="text-sm text-emerald-600/60 list-none italic">無新增項目</li>}
                      </ul>
                    </div>
                    
                    <div className="p-4 bg-blue-50 rounded-2xl border border-blue-100">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-blue-700 text-xs font-black uppercase tracking-widest">語意優化與潤飾項目</div>
                        <div className="text-blue-700 font-bold bg-blue-200/50 px-2.5 py-0.5 rounded-full text-xs">{pendingAiResult.summary.updated.length} 筆</div>
                      </div>
                      <ul className="list-disc list-inside space-y-1.5">
                         {pendingAiResult.summary.updated.length > 0 ? pendingAiResult.summary.updated.map((item: string, i: number) => (
                           <li key={i} className="text-sm text-blue-800">{item}</li>
                         )) : <li className="text-sm text-blue-600/60 list-none italic">無變更項目</li>}
                      </ul>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-slate-600 text-xs font-black uppercase tracking-widest">合併與去重項目</div>
                        <div className="text-slate-600 font-bold bg-slate-200 px-2.5 py-0.5 rounded-full text-xs">{pendingAiResult.summary.merged.length} 筆</div>
                      </div>
                      <ul className="list-disc list-inside space-y-1.5">
                         {pendingAiResult.summary.merged.length > 0 ? pendingAiResult.summary.merged.map((item: string, i: number) => (
                           <li key={i} className="text-sm text-slate-700">{item}</li>
                         )) : <li className="text-sm text-slate-400 list-none italic">無合併項目</li>}
                      </ul>
                    </div>
                  </div>
                </section>
              </div>

              <div className="p-8 bg-slate-50 border-t border-slate-100 flex gap-4">
                <button 
                  onClick={() => setPendingAiResult(null)}
                  className="flex-1 py-4 bg-white border border-slate-200 text-slate-500 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all"
                >
                  取消並不儲存
                </button>
                <button 
                  onClick={handleConfirmAiAnalysis}
                  disabled={isCleaning || Object.values(selectedProposedPoints).flat().length === 0}
                  className="flex-[2] py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-500/20 hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                >
                  {isCleaning ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                  確認套用變更
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {deleteConfirm && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
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
                    } else if (deleteConfirm.type === 'floor') {
                      performDeleteFloor(deleteConfirm.id);
                    } else if (deleteConfirm.type === 'requirement') {
                      deleteDoc(doc(db, 'requirements', deleteConfirm.id)).then(() => setDeleteConfirm(null));
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

        {showLoginModal && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowLoginModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden p-8 space-y-8">
               <div className="text-center space-y-2">
                 <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center text-white mx-auto shadow-xl shadow-blue-500/20">
                   <Building2 size={32} />
                 </div>
                 <h3 className="text-2xl font-black text-slate-900">協作者登入</h3>
                 <p className="text-sm text-slate-500 font-medium">請使用指定的 Email 帳號進入編輯模式</p>
               </div>
               
               <form onSubmit={handleLogin} className="space-y-6">
                 <div className="space-y-2">
                   <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">帳號 (Email)</label>
                   <input 
                     required
                     type="email"
                     value={loginEmail}
                     onChange={(e) => setLoginEmail(e.target.value)}
                     placeholder="your@email.com"
                     className="w-full h-14 px-5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all placeholder:text-slate-300"
                   />
                 </div>
                 <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">密碼 (Password)</label>
                    <input 
                      required
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full h-14 px-5 bg-slate-50 border border-slate-200 rounded-2xl text-slate-900 font-bold focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 outline-none transition-all placeholder:text-slate-300"
                    />
                 </div>
                 <button 
                   type="submit"
                   disabled={isLoginLoading}
                   className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black shadow-xl shadow-blue-500/30 hover:bg-blue-700 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
                 >
                   {isLoginLoading ? <Loader2 size={20} className="animate-spin" /> : <ShieldAlert size={20} />}
                   授權並進入系統
                 </button>
               </form>
               
               <button 
                 onClick={() => setShowLoginModal(false)}
                 className="w-full py-2 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest"
               >
                 暫不登入 (僅限檢視)
               </button>
            </motion.div>
          </div>
        )}

        {showAuthErrorModal && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAuthErrorModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden p-8 space-y-6">
              
              <button 
                onClick={() => setShowAuthErrorModal(false)}
                className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-2 hover:bg-slate-50 rounded-full transition-colors"
                id="btn-close-auth-err"
              >
                <X size={20} />
              </button>

              <div className="space-y-2 text-center">
                <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center text-amber-500 mx-auto shadow-sm border border-amber-100">
                  <ShieldAlert size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-900">Google 雲端連結排解助手</h3>
                <p className="text-xs text-slate-500 font-medium">若點擊登入時遇到錯誤或視窗無回應，請參考以下方案</p>
              </div>

              {authErrorCode && (
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 text-center">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">錯誤代碼 / ERROR CODE</span>
                  <code className="text-xs font-mono font-bold text-red-500 bg-red-50/50 px-2 py-0.5 rounded border border-red-100 mt-1 inline-block">
                    {authErrorCode}
                  </code>
                </div>
              )}

              <div className="space-y-4 text-slate-600 text-xs leading-relaxed max-h-[50vh] overflow-y-auto pr-1">
                <p>
                  由於瀏覽器的安全隱私政策（如禁用第三方 Cookie / 阻擋跨網域彈出視窗），在 <strong>AI Studio 的「內嵌預覽框架」裡面</strong> 直接點擊 Google 彈出式授權時，常常會遇到驗證金鑰無法傳回的情況（常見為 <code>auth/popup-closed-by-user</code> 或網頁無回應）。
                </p>

                <div className="space-y-3 bg-blue-50/60 border border-blue-100 p-4 rounded-2xl">
                  <p className="font-bold text-blue-900 flex items-center gap-1">
                    <Sparkles size={14} /> 方案 A：在新分頁/新視窗中開啟 (強烈推薦 100% 成功性能)
                  </p>
                  <p className="text-[11px] text-blue-700">
                    在獨立網頁分頁中，瀏覽器不受 iFrame 安全限制阻擋。您可以正常點擊彈出視窗登入 Google 並授權：
                  </p>
                  <a 
                    href={window.location.href}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="w-full h-11 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md shadow-blue-500/10 transition-all hover:scale-[1.01] active:scale-[0.99] text-[11px] uppercase tracking-wider text-center"
                    id="btn-open-new-tab"
                  >
                    <ExternalLink size={14} className="inline" /> 在新分頁開啟此 APP 連結
                  </a>
                </div>

                <div className="space-y-3 bg-slate-50 border border-slate-200 p-4 rounded-2xl">
                  <p className="font-bold text-slate-800 flex items-center gap-1">
                    <Key size={14} className="text-slate-500" /> 方案 B：手動貼上 Cloud Access Token (極速備用)
                  </p>
                  <p className="text-[11px] text-slate-500">
                    如果您已從 Google APIs OAuth 取得隨機 `access_token`，可以直接黏貼在此：
                  </p>
                  <div className="flex gap-2">
                    <input 
                      type="password"
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder="請貼上以 ya29.... 開頭的 Access Token"
                      className="flex-1 h-10 px-3 bg-white border border-slate-300 rounded-lg text-[11px] text-slate-700 outline-none focus:border-blue-500 transition-all font-mono"
                      id="input-manual-token"
                    />
                    <button
                      onClick={handleSaveManualToken}
                      disabled={!manualToken.trim()}
                      className="h-10 px-4 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-lg text-[11px] transition-all disabled:opacity-40 cursor-pointer shrink-0"
                      id="btn-save-manual-token"
                    >
                      儲存權杖
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button 
                  onClick={() => setShowAuthErrorModal(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  id="btn-close-diagnostic"
                >
                  關閉診斷
                </button>
              </div>

            </motion.div>
          </div>
        )}

        {selectedLightboxPhoto && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
               initial={{ opacity: 0 }} 
               animate={{ opacity: 1 }} 
               exit={{ opacity: 0 }} 
               onClick={() => setSelectedLightboxPhoto(null)} 
               className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" 
            />
            <motion.div 
               initial={{ opacity: 0, scale: 0.9 }} 
               animate={{ opacity: 1, scale: 1 }} 
               exit={{ opacity: 0, scale: 0.9 }} 
               className="relative max-w-5xl max-h-[90vh] w-full flex flex-col items-center justify-center"
            >
               <button 
                 onClick={() => setSelectedLightboxPhoto(null)}
                 className="absolute -top-12 right-0 p-2 text-white/70 hover:text-white transition-colors bg-white/10 rounded-full hover:bg-white/20"
               >
                 <X size={24} />
               </button>
               
               <div className="relative w-full flex items-center justify-center group">
                 {/* Navigation Buttons */}
                 {currentSpacePhotos.length > 1 && (
                   <>
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         const currentIndex = currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto);
                         if (currentIndex > -1 && currentSpacePhotos.length > 0) {
                           const nextIndex = (currentIndex - 1 + currentSpacePhotos.length) % currentSpacePhotos.length;
                           setSelectedLightboxPhoto(currentSpacePhotos[nextIndex].url);
                         }
                       }}
                       className="absolute left-4 md:left-6 p-3 text-white bg-slate-950/70 hover:bg-slate-950 hover:scale-105 transition-all border border-white/10 rounded-full shadow-2xl z-20 hover:text-blue-400 active:scale-95"
                       title="上一張"
                     >
                       <ChevronLeft size={24} />
                     </button>
                     
                     <button 
                       onClick={(e) => {
                         e.stopPropagation();
                         const currentIndex = currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto);
                         if (currentIndex > -1 && currentSpacePhotos.length > 0) {
                           const nextIndex = (currentIndex + 1) % currentSpacePhotos.length;
                           setSelectedLightboxPhoto(currentSpacePhotos[nextIndex].url);
                         }
                       }}
                       className="absolute right-4 md:right-6 p-3 text-white bg-slate-950/70 hover:bg-slate-950 hover:scale-105 transition-all border border-white/10 rounded-full shadow-2xl z-20 hover:text-blue-400 active:scale-95"
                       title="下一張"
                     >
                       <ChevronRight size={24} />
                     </button>
                   </>
                 )}

                 <img 
                   src={selectedLightboxPhoto} 
                   alt="Enlarged space view" 
                   className="max-h-[80vh] max-w-full object-contain rounded-2xl shadow-2xl border border-white/5"
                 />
               </div>

               {/* Indicator badge */}
               {currentSpacePhotos.length > 0 && currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto) > -1 && (
                 <div className="mt-4 text-white/90 bg-slate-950/80 px-4 py-2 rounded-full border border-white/10 tracking-widest text-xs font-black shadow-xl flex items-center gap-2">
                   <span>照片</span>
                   <span className="text-blue-400">
                     {currentSpacePhotos.findIndex(p => p.url === selectedLightboxPhoto) + 1}
                   </span>
                   <span className="opacity-40">/</span>
                   <span>{currentSpacePhotos.length}</span>
                 </div>
               )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ReportView({ 
  projectMaps, 
  customTopics, 
  allRequirements,
  spacePhotos,
  driveAccessToken,
  initiateGoogleOAuth,
  setNotification
}: { 
  projectMaps: ProjectMap[], 
  customTopics: Topic[], 
  allRequirements: RequirementCategory[],
  spacePhotos: SpacePhoto[],
  driveAccessToken: string | null,
  initiateGoogleOAuth: (cb: (token: string) => void) => void,
  setNotification: (n: any) => void
}) {
  const globalTrades = customTopics.filter(t => t.type === 'trade');
  const [isExporting, setIsExporting] = useState(false);

  const performExport = async (token: string) => {
    setIsExporting(true);
    setNotification({ message: '正在產生 Google Docs，這可能需要一點時間...', type: 'ai' });
    
    try {
      const docChildren: any[] = [];

      const getImageData = async (photo: SpacePhoto): Promise<{ data: Uint8Array, width: number, height: number } | null> => {
        try {
          console.log("Processing photo for design doc:", photo);
          let blob: Blob | null = null;
          if (photo.driveFileId) {
            console.log("Fetching Drive file content for ID:", photo.driveFileId);
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${photo.driveFileId}?alt=media`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            console.log("Drive file fetch response status:", res.status);
            if (res.ok) {
              blob = await res.blob();
              console.log("Successfully fetched Drive file blob, size:", blob?.size);
            } else {
              const textErr = await res.text();
              console.error("Failed to fetch Drive file blob:", textErr);
            }
          } else if (photo.url && !photo.url.startsWith('blob:')) {
            try {
              console.log("Fetching regular URL:", photo.url);
              const res = await fetch(photo.url);
              if (res.ok) {
                blob = await res.blob();
                console.log("Successfully fetched regular URL blob, size:", blob?.size);
              }
            } catch (err) {
              console.warn('CORS or fetch failed for url', err);
            }
          }

          if (!blob && photo.url) {
             if (photo.url.startsWith('data:image') || photo.url.startsWith('blob:')) {
                blob = await (await fetch(photo.url)).blob();
             }
          }

          if (!blob) return null;

          return await new Promise((resolve) => {
            const img = new Image();
            // img.crossOrigin = 'anonymous'; // Commented out to prevent same-origin security errors with blob: URLs
            img.onload = () => {
              const canvas = document.createElement('canvas');
              const MAX_WIDTH = 450;
              let width = img.width;
              let height = img.height;

              if (width > MAX_WIDTH) {
                height = Math.round((height * MAX_WIDTH) / width);
                width = MAX_WIDTH;
              }

              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                canvas.toBlob((b) => {
                  if (b) {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({ data: new Uint8Array(reader.result as ArrayBuffer), width, height });
                    reader.readAsArrayBuffer(b);
                  } else {
                    resolve(null);
                  }
                }, 'image/jpeg', 0.85);
              } else {
                resolve(null);
              }
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(blob!);
          });
        } catch (e) {
          console.warn('Image process failed', e);
          return null;
        }
      };

      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 2000, after: 1000 },
          children: [
            new TextRun({ text: "屏東榮民總醫院龍泉分院", size: 52, bold: true }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "「龍泉分院B棟3F、5F改建工程委託", size: 36 }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [
            new TextRun({ text: "設計監造技術服務案(案號：1120101002)」", size: 36 }),
          ]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 1400 },
          pageBreakBefore: false,
          children: [
            new TextRun({ text: "細部設計需求書", size: 40 }),
          ]
        })
      );

      // 2. Beautiful Table of Contents with Exact Pre-calculated Page Numbers and Leader Dots!
      const pageEstimates: Record<string, number> = {};
      let estPage = 4; // First floor content begins on Page 4 (TOC fits on Page 2 & 3)
      let estLines = 0;
      const LINES_PER_PAGE = 31; // Standard lines on a printed page

      for (const floor of projectMaps) {
        const floorSpaces = customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === floor.id || t.floorId === 'global'));
        if (floorSpaces.length === 0) continue;
        
        // Floor header has pageBreakBefore: true
        if (estLines > 0) {
          estPage += 1;
          estLines = 0;
        }
        pageEstimates[`floor-${floor.id}`] = estPage;

        for (const space of floorSpaces) {
          const reqs = allRequirements.filter(r => r.space === space.name || (!r.space && (r.title === space.name || r.title.includes(space.name))));
          const photos = spacePhotos.filter(p => p.space === space.name);
          if (reqs.length === 0 && photos.length === 0) continue;
          
          // Estimate lines occupied by this space table
          let spaceLines = 4; // Margin + header within table
          if (reqs.length > 0) {
            spaceLines += 2; // "需求項目："
            for (const req of reqs) {
              spaceLines += 1; // title
              spaceLines += req.points.length; // bullets
            }
          }
          if (photos.length > 0) {
            spaceLines += 2; // "空間照片："
            spaceLines += photos.length * 12; // each photo takes about 12 lines
          }
          
          if (estLines + spaceLines > LINES_PER_PAGE) {
            const totalLines = estLines + spaceLines;
            const extraPages = Math.floor(totalLines / LINES_PER_PAGE);
            pageEstimates[`space-${floor.id}-${space.name}`] = estPage;
            estPage += extraPages;
            estLines = totalLines % LINES_PER_PAGE;
          } else {
            pageEstimates[`space-${floor.id}-${space.name}`] = estPage;
            estLines += spaceLines;
          }
        }
      }

      if (globalTrades.length > 0) {
        if (estLines > 0) {
          estPage += 1;
          estLines = 0;
        }
        pageEstimates[`trades-header`] = estPage;
        
        for (const trade of globalTrades) {
          const reqs = allRequirements.filter(r => r.space === trade.name || (!r.space && (r.title === trade.name || r.title.includes(trade.name))));
          const photos = spacePhotos.filter(p => p.space === trade.name);
          
          if (reqs.length === 0 && photos.length === 0) continue;
          
          let tradeLines = 4;
          if (reqs.length > 0) {
            tradeLines += 2;
            for (const req of reqs) {
              tradeLines += 1;
              tradeLines += req.points.length;
            }
          }
          if (photos.length > 0) {
            tradeLines += 2;
            tradeLines += photos.length * 12;
          }
          
          if (estLines + tradeLines > LINES_PER_PAGE) {
            const totalLines = estLines + tradeLines;
            const extraPages = Math.floor(totalLines / LINES_PER_PAGE);
            pageEstimates[`trade-${trade.name}`] = estPage;
            estPage += extraPages;
            estLines = totalLines % LINES_PER_PAGE;
          } else {
            pageEstimates[`trade-${trade.name}`] = estPage;
            estLines += tradeLines;
          }
        }
      }

      const tocParagraphs: any[] = [
        new Paragraph({
          pageBreakBefore: true,
          text: "文件目錄",
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 400 }
        }),
        new TableOfContents("目錄內容", {
          hyperlink: true,
          headingStyleRange: "2-3",
        }),
        new Paragraph({
          text: "",
          spacing: { after: 200 }
        })
      ];

      // Add dynamic table of contents to children array
      docChildren.push(...tocParagraphs);

      let secIndex = 1;
      for (const floor of projectMaps) {
        const floorSpaces = customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === floor.id || t.floorId === 'global'));
        if (floorSpaces.length === 0) continue;
        
        let floorCount = 0;
        const floorTitle = new Paragraph({
          text: `${secIndex++}. ${floor.name} 空間需求`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 400 },
          pageBreakBefore: true,
        });
        const floorChildren: any[] = [floorTitle];
        
        for (const space of floorSpaces) {
          const reqs = allRequirements.filter(r => r.space === space.name || (!r.space && (r.title === space.name || r.title.includes(space.name))));
          const photos = spacePhotos.filter(p => p.space === space.name);
          
          if (reqs.length === 0 && photos.length === 0) continue;
          floorCount++;
          
          const cellContent: any[] = [];
          if (reqs.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "需求項目：", bold: true, size: 28 })],
              spacing: { after: 200 }
            }));
            for (let i = 0; i < reqs.length; i++) {
              const req = reqs[i];
              cellContent.push(new Paragraph({
                children: [
                  new TextRun({ text: `${i + 1}. ${req.title}`, bold: true, size: 24 })
                ],
                spacing: { before: 200, after: 100 }
              }));
              for (const pt of req.points) {
                cellContent.push(new Paragraph({
                  children: [new TextRun({ text: pt, size: 24 })],
                  bullet: { level: 0 },
                  spacing: { after: 100 }
                }));
              }
            }
          }
          if (photos.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "空間照片：", bold: true, size: 28 })],
              spacing: { before: 400, after: 200 }
            }));
            for (const photo of photos) {
              const imgData = await getImageData(photo);
              if (imgData) {
                cellContent.push(new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 100, after: 100 },
                  children: [
                    new ImageRun({
                      type: 'jpg',
                      data: imgData.data,
                      transformation: { width: imgData.width, height: imgData.height }
                    })
                  ]
                }));
              }
            }
          }
          
          const spaceTable = new Table({
            columnWidths: [9360],
            width: { size: 9360, type: WidthType.DXA },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: "F1F5F9" },
                    width: { size: 9360, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        text: space.name,
                        heading: HeadingLevel.HEADING_3,
                      })
                    ]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 9360, type: WidthType.DXA },
                    children: cellContent.length > 0 ? cellContent : [new Paragraph({ text: "" })]
                  })
                ]
              })
            ]
          });
          floorChildren.push(spaceTable, new Paragraph({ text: "", spacing: { after: 400 } }));
        }
        if (floorCount > 0) {
          docChildren.push(...floorChildren);
        }
      }

      if (globalTrades.length > 0) {
        let tradeCount = 0;
        const tradeTitle = new Paragraph({
          text: `${secIndex++}. 全區分項工程需求`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 400, after: 400 },
          pageBreakBefore: true,
        });
        const tradeChildren: any[] = [tradeTitle];
        
        for (const trade of globalTrades) {
          const reqs = allRequirements.filter(r => r.space === trade.name || (!r.space && (r.title === trade.name || r.title.includes(trade.name))));
          const photos = spacePhotos.filter(p => p.space === trade.name);
          if (reqs.length === 0 && photos.length === 0) continue;
          tradeCount++;
          
          const cellContent: any[] = [];
          if (reqs.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "需求項目：", bold: true, size: 28 })],
              spacing: { after: 200 }
            }));
            for (let i = 0; i < reqs.length; i++) {
              const req = reqs[i];
              cellContent.push(new Paragraph({
                children: [
                  new TextRun({ text: `${i + 1}. ${req.title}`, bold: true, size: 24 })
                ],
                spacing: { before: 200, after: 100 }
              }));
              for (const pt of req.points) {
                cellContent.push(new Paragraph({
                  children: [new TextRun({ text: pt, size: 24 })],
                  bullet: { level: 0 },
                  spacing: { after: 100 }
                }));
              }
            }
          }
          
          if (photos.length > 0) {
            cellContent.push(new Paragraph({
              children: [new TextRun({ text: "空間照片：", bold: true, size: 28 })],
              spacing: { before: 400, after: 200 }
            }));
            for (const photo of photos) {
              const imgData = await getImageData(photo);
              if (imgData) {
                cellContent.push(new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { before: 100, after: 100 },
                  children: [
                    new ImageRun({
                      type: 'jpg',
                      data: imgData.data,
                      transformation: { width: imgData.width, height: imgData.height }
                    })
                  ],
                }));
              }
            }
          }
          
          const tradeTable = new Table({
            columnWidths: [9360],
            width: { size: 9360, type: WidthType.DXA },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" }
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    shading: { fill: "F1F5F9" },
                    width: { size: 9360, type: WidthType.DXA },
                    children: [
                      new Paragraph({
                        text: trade.name,
                        heading: HeadingLevel.HEADING_3,
                      })
                    ]
                  })
                ]
              }),
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 9360, type: WidthType.DXA },
                    children: cellContent.length > 0 ? cellContent : [new Paragraph({ text: "" })]
                  })
                ]
              })
            ]
          });
          tradeChildren.push(tradeTable, new Paragraph({ text: "", spacing: { after: 400 } }));
        }
        if (tradeCount > 0) docChildren.push(...tradeChildren);
      }

      const doc = new Document({
        features: {
          updateFields: true,
        },
        styles: {
          paragraphStyles: [
            {
              id: "toc 1",
              name: "toc 1",
              basedOn: "Normal",
              next: "Normal",
              run: {
                bold: true,
                size: 28, // 14pt (matches 28 in docx)
                color: "1E3A8A", // Deep Navy
              },
              paragraph: {
                spacing: { before: 180, after: 80 }
              }
            },
            {
              id: "toc 2",
              name: "toc 2",
              basedOn: "Normal",
              next: "Normal",
              run: {
                size: 24, // 12pt (matches 24 in docx)
                color: "334155", // Slate-700
              },
              paragraph: {
                spacing: { before: 80, after: 40 },
                indent: { left: 400 } // indent to align beautifully
              }
            }
          ]
        },
        sections: [{
          properties: {
            page: {
              size: {
                width: 11906, // A4 width (~21cm)
                height: 16838, // A4 height (~29.7cm)
              },
              margin: {
                top: 1440, // 1 inch
                bottom: 1440,
                left: 1440,
                right: 1440,
              }
            }
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                     new TextRun({ children: ["- "] }),
                     new TextRun({ children: [PageNumber.CURRENT] }),
                     new TextRun({ children: [" -"] }),
                  ]
                })
              ]
            })
          },
          children: docChildren
        }]
      });

      const blob = await Packer.toBlob(doc);
      const metadata = {
        name: '細部設計需求書_屏東榮總龍泉分院B棟',
        mimeType: 'application/vnd.google-apps.document'
      };
      
      const boundary = 'foo_bar_baz_boundary_docx';
      const metadataStr = JSON.stringify(metadata);
      const buffer = await blob.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);
      
      const preBuffer = new TextEncoder().encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`
      );
      const postBuffer = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
      const combinedBuffer = new Uint8Array(preBuffer.length + uint8Array.length + postBuffer.length);
      combinedBuffer.set(preBuffer, 0);
      combinedBuffer.set(uint8Array, preBuffer.length);
      combinedBuffer.set(postBuffer, preBuffer.length + uint8Array.length);

      const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: combinedBuffer
      });

      if (!uploadRes.ok) throw new Error('上傳 Docs 失敗: ' + uploadRes.statusText);
      const fileData = await uploadRes.json();
      const documentId = fileData.id;

      setNotification({ message: '成功匯出 Google Docs 細部設計需求書！可至雲端硬碟查看。', type: 'success' });
      window.open(`https://docs.google.com/document/d/${documentId}/edit`, '_blank');
      
    } catch (err: any) {
      console.error(err);
      setNotification({ message: '匯出失敗: ' + err.message, type: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportToDocs = () => {
    if (!driveAccessToken) {
      initiateGoogleOAuth((token) => performExport(token));
    } else {
      performExport(driveAccessToken);
    }
  };
  
  if (allRequirements.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4 text-slate-500">
          <Loader2 size={32} className="animate-spin text-blue-500" />
          <p className="font-bold tracking-widest uppercase">載入完整報告中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50 text-slate-800 p-8">
      <div className="max-w-5xl mx-auto space-y-12">
        <header className="border-b-4 border-slate-900 pb-6 flex justify-between items-end">
          <div>
            <h2 className="text-4xl font-black tracking-tight text-slate-900 mb-2">專案需求彙整總表</h2>
            <p className="text-lg font-bold text-slate-500 uppercase tracking-widest">各樓層空間與分項工程需求整理</p>
          </div>
          <button 
            onClick={handleExportToDocs}
            disabled={isExporting}
            className="flex items-center gap-2 px-5 py-3 bg-blue-600 text-white font-bold rounded-xl text-sm hover:bg-blue-700 transition-all shadow-md active:scale-95 disabled:opacity-50"
          >
            {isExporting ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
            輸出 Google Docs
          </button>
        </header>

        {projectMaps.map(floor => {
          const floorSpaces = customTopics.filter(t => (t.type === 'space' || !t.type) && (t.isDefault || t.floorId === floor.id || t.floorId === 'global'));
          if (floorSpaces.length === 0) return null;
          
          return (
            <section key={floor.id} className="space-y-6">
              <h3 className="text-3xl font-black text-blue-700 border-b-2 border-blue-200 pb-3 flex items-center gap-3">
                <MapIcon size={28} />
                {floor.name}
              </h3>
              
              <div className="space-y-8 pl-4 lg:pl-8">
                {floorSpaces.map(space => {
                  const reqs = allRequirements.filter(r => r.space === space.name || (!r.space && (r.title === space.name || r.title.includes(space.name))));
                  if (reqs.length === 0) return null;
                  
                  return (
                    <div key={space.id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="bg-slate-100 px-6 py-4 border-b border-slate-200">
                         <h4 className="text-xl font-bold text-slate-800">{space.name}</h4>
                      </div>
                      <div className="p-6 space-y-6">
                        {reqs.map((req, i) => (
                          <div key={req.id}>
                            <h5 className="font-bold text-blue-600 mb-3 text-lg">{i + 1}. {req.title}</h5>
                            <ul className="list-disc pl-6 space-y-2 text-slate-700 leading-relaxed">
                              {req.points.map((pt, j) => (
                                <li key={j}>{pt}</li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}

        {globalTrades.length > 0 && (
          <section className="space-y-6 mt-16 pt-8 border-t-4 border-slate-200">
            <h3 className="text-3xl font-black text-emerald-700 border-b-2 border-emerald-200 pb-3 flex items-center gap-3">
              <ClipboardList size={28} />
              全區分項工程
            </h3>
            
            <div className="space-y-8 pl-4 lg:pl-8">
              {globalTrades.map(trade => {
                const reqs = allRequirements.filter(r => r.space === trade.name || (!r.space && (r.title === trade.name || r.title.includes(trade.name))));
                if (reqs.length === 0) return null;
                
                return (
                  <div key={trade.id} className="bg-white rounded-2xl shadow-sm border border-emerald-100 overflow-hidden">
                    <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100">
                       <h4 className="text-xl font-bold text-emerald-900">{trade.name}</h4>
                    </div>
                    <div className="p-6 space-y-6">
                      {reqs.map((req, i) => (
                        <div key={req.id}>
                          <h5 className="font-bold text-emerald-600 mb-3 text-lg">{i + 1}. {req.title}</h5>
                          <ul className="list-disc pl-6 space-y-2 text-slate-700 leading-relaxed">
                            {req.points.map((pt, j) => (
                              <li key={j}>{pt}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
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
  isSortable,
  user,
  badgeCount
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
  isSortable?: boolean,
  user?: User | null,
  badgeCount?: number
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
        {isSortable && !collapsed && user && (
          <span className="text-slate-300 group-hover/nav:text-slate-500 cursor-grab active:cursor-grabbing">
            <GripVertical size={14} />
          </span>
        )}
        <span className={`${active ? 'text-blue-500' : 'text-slate-500 group-hover:text-blue-600'} transition-colors shrink-0`}>{icon}</span>
        {!collapsed && <span className="truncate text-sm font-bold uppercase tracking-wider">{label}</span>}
        {!collapsed && badgeCount && badgeCount > 0 ? (
          <span className="ml-auto bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full flex items-center justify-center min-w-[1.25rem]">
            {badgeCount}
          </span>
        ) : null}
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

function NoteItem({ note, showLabel = false, onToggleStatus, onDelete, onEdit, currentUserEmail }: { note: Note, showLabel?: boolean, onToggleStatus: (id: string, current: string) => void, onDelete: (id: string) => void, onEdit: (note: Note) => void, currentUserEmail?: string | null }) {
  const isConfirmed = note.status === 'confirmed';
  const isNursingDept = currentUserEmail === 'user@ptvgh.gov.tw';
  const canModify = !isNursingDept || note.authorEmail === currentUserEmail;
  
  const getAuthorDisplay = (email: string | undefined | null) => {
    if (!email) return '工程承辦人';
    if (email === 'user@ptvgh.gov.tw') return '護理部';
    if (email === 'jason2134@gmail.com') return '工程承辦人';
    return email.split('@')[0];
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-3 glass-panel rounded-xl hover:bg-black/5 transition-all group border-l-2 mb-2 ${isConfirmed ? 'border-l-emerald-500 bg-emerald-50/10' : 'border-l-red-500/50 bg-red-50/10'}`}
    >
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black tracking-widest">{getAuthorDisplay(note.authorEmail)}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{note.timestamp.split(' ')[1] || note.timestamp}</span>
          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter shadow-sm ${
            isConfirmed ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
          }`}>
            {isConfirmed ? '已加入' : '未加入'}
          </span>
        </div>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
           {canModify && !isNursingDept && (
             <button 
               onClick={() => onToggleStatus(note.id, note.status)}
               className={`${note.status === 'confirmed' ? 'text-emerald-500' : 'text-slate-500 hover:text-emerald-400'} p-0.5`}
               title="確認狀態"
             >
               <CheckCircle2 size={10} />
             </button>
           )}
           {canModify && (
             <button 
               onClick={() => onEdit(note)}
               className="text-slate-500 hover:text-blue-600 p-0.5"
               title="編輯內容"
             >
               <FileText size={10} />
             </button>
           )}
           {canModify && (
             <button 
               onClick={() => onDelete(note.id)}
               className="text-slate-500 hover:text-red-500 p-0.5"
               title="刪除紀錄"
             >
               <X size={10} />
             </button>
           )}
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

function NotesArchived({ notes, onToggleStatus, onDelete, onEdit, currentUserEmail }: { notes: Note[], onToggleStatus: any, onDelete: any, onEdit: any, currentUserEmail?: string | null }) {
  const [expandedDates, setExpandedDates] = useState<string[]>([]);

  // Group by date
  const grouped = notes.reduce((acc: Record<string, Note[]>, note) => {
    const date = note.timestamp.split(' ')[0] || 'Unknown Date';
    if (!acc[date]) acc[date] = [];
    acc[date].push(note);
    return acc;
  }, {});

  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  useEffect(() => {
    // Expand latest date by default once dates are available
    if (dates.length > 0 && !hasAutoExpanded) {
      setExpandedDates([dates[0]]);
      setHasAutoExpanded(true);
    }
  }, [dates, hasAutoExpanded]);

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
                    currentUserEmail={currentUserEmail}
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
