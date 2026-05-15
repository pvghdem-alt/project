import fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf8');

// I will just open src/App.tsx, find the section `<div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">`
// and replace its contents.

const startMark = '<div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">';
const endMark = '</aside>';

const oldBlock = content.substring(content.indexOf(startMark), content.indexOf(endMark));

// We want the block to look like:
const newBlock = `<div className="flex-1 overflow-y-auto p-6 space-y-8 scroll-smooth">
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
                          className={\`text-xs font-bold hover:underline cursor-pointer flex items-center gap-1 transition-all \${isListening ? 'text-red-500 animate-pulse' : 'text-blue-500'}\`}
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
                       <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">當前會議紀錄</h4>
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
`;

content = content.replace(oldBlock, newBlock);
fs.writeFileSync('src/App.tsx', content);
console.log("Rewrite complete.");
