import React, { useState, useCallback, useEffect } from 'react';
import SRTUpload, { splitByLength } from './components/SRTUpload';
import SentenceList from './components/SentenceList';
import PinLock from './components/PinLock';
import { processTranscriptBatch } from './services/geminiService';
import { GenerationState, SentencePair, DialogueSession } from './types';

const BATCH_SIZE = 12;
const HISTORY_CACHE_KEY = 'app_srt_history';
const CURRENT_SESSION_ID_KEY = 'app_srt_current_id';

const App: React.FC = () => {
  const [isLocked, setIsLocked] = useState(true);
  const [state, setState] = useState<GenerationState>({
    isLoading: false,
    error: null,
    data: null
  });

  const [history, setHistory] = useState<DialogueSession[]>([]);
  const [playlist, setPlaylist] = useState<DialogueSession[]>([]);
  const [session, setSession] = useState<DialogueSession | null>(null);
  const [delaySeconds, setDelaySeconds] = useState<number>(() => 
    parseInt(localStorage.getItem('app_delay_seconds') || '4', 10)
  );

  const startBatchRef = React.useRef<((session: DialogueSession) => Promise<void>) | null>(null);

  /**
   * Re-processes session text to ensure practice-friendly chunking.
   */
  const ensureManageableDialogues = (session: DialogueSession): DialogueSession => {
    const finalDialogues: string[] = [];
    let needsUpdate = false;

    const cleanSource = session.allDialogues.filter(d => {
      const isAlphanumeric = /[a-zA-Z0-9\u0900-\u097F]/.test(d);
      const wordCount = d.trim().split(/\s+/).filter(w => w.length > 0).length;
      return isAlphanumeric && wordCount > 0;
    });
    
    if (cleanSource.length !== session.allDialogues.length) needsUpdate = true;

    cleanSource.forEach(d => {
      const words = d.split(/\s+/).filter(w => w.length > 0);
      const multiSentenceCheck = d.match(/[.?!।]\s+/);

      if (words.length > 16 || multiSentenceCheck) {
        needsUpdate = true;
        // Smarter split
        const parts = d.split(/(?<=[.?!।])\s+/);
        parts.forEach(p => {
            const trimmed = p.trim();
            const pWords = trimmed.split(/\s+/).filter(w => w.length > 0);
            if (!/[a-zA-Z0-9\u0900-\u097F]/.test(trimmed)) return;
            
            if (pWords.length > 16) {
                finalDialogues.push(...splitByLength(trimmed));
            } else {
                finalDialogues.push(trimmed);
            }
        });
      } else {
        finalDialogues.push(d);
      }
    });

    // Post-process: merge very short dialogues if they fit
    const merged: string[] = [];
    let i = 0;
    while (i < finalDialogues.length) {
      let current = finalDialogues[i];
      const currentWords = current.split(/\s+/).length;
      
      if (currentWords < 3 && i < finalDialogues.length - 1) {
        const next = finalDialogues[i + 1];
        const nextWords = next.split(/\s+/).length;
        if (currentWords + nextWords <= 16) {
          merged.push(current + " " + next);
          i += 2;
          needsUpdate = true;
          continue;
        }
      }
      merged.push(current);
      i++;
    }

    if (!needsUpdate || merged.length === 0) return session;

    return {
      ...session,
      allDialogues: merged,
    };
  };

  const updateHistory = useCallback((updatedSession: DialogueSession) => {
    setHistory(prev => {
      const filtered = prev.filter(s => s.id !== updatedSession.id);
      const newHistory = [updatedSession, ...filtered].slice(0, 10);
      localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(newHistory));
      return newHistory;
    });
  }, []);

  const handleFinishedSession = useCallback((finished: DialogueSession) => {
    const updated = { ...finished, currentIndex: finished.allDialogues.length };
    updateHistory(updated);
    
    setPlaylist(prev => {
      const currentIdx = prev.findIndex(s => s.id === finished.id);
      const nextInPlaylist = prev[currentIdx + 1];

      if (nextInPlaylist) {
        setSession(nextInPlaylist);
        localStorage.setItem(CURRENT_SESSION_ID_KEY, nextInPlaylist.id);
        if (startBatchRef.current) startBatchRef.current(nextInPlaylist);
        return prev;
      } else {
        setState(prev => ({ ...prev, isLoading: false, data: null, error: null }));
        setSession(null);
        localStorage.removeItem(CURRENT_SESSION_ID_KEY);
        return [];
      }
    });
  }, [updateHistory]);

  const startBatch = useCallback(async (currentSession: DialogueSession) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));
    
    const batch = currentSession.allDialogues.slice(
      currentSession.currentIndex, 
      currentSession.currentIndex + BATCH_SIZE
    );

    if (batch.length === 0) {
      handleFinishedSession(currentSession);
      return;
    }

    try {
      const result = await processTranscriptBatch(batch);
      if (result.data.length === 0) {
         const nextIdx = currentSession.currentIndex + BATCH_SIZE;
         if (nextIdx < currentSession.allDialogues.length) {
            const updated = { ...currentSession, currentIndex: nextIdx };
            setSession(updated);
            startBatch(updated);
            return;
         } else {
            handleFinishedSession(currentSession);
            return;
         }
      }
      setState(prev => ({ ...prev, isLoading: false, data: result.data }));
    } catch (err: any) {
      console.error("Batch processing error:", err);
      setState(prev => ({ 
        ...prev, 
        isLoading: false, 
        error: `Translation Error: ${err.message || "Unknown error"}. Please check your connection or API key.` 
      }));
    }
  }, [handleFinishedSession]);

  useEffect(() => {
    startBatchRef.current = startBatch;
  }, [startBatch]);

  useEffect(() => {
    if (!isLocked) {
      const cachedHistory = localStorage.getItem(HISTORY_CACHE_KEY);
      if (cachedHistory) {
        try {
          const parsed: DialogueSession[] = JSON.parse(cachedHistory);
          setHistory(parsed);
          
          const activeId = localStorage.getItem(CURRENT_SESSION_ID_KEY);
          if (activeId) {
            let lastSession = parsed.find(s => s.id === activeId);
            if (lastSession) {
              lastSession = ensureManageableDialogues(lastSession);
              setSession(lastSession);
              setPlaylist([lastSession]);
              startBatch(lastSession);
            }
          }
        } catch (e) {
          console.error("Failed to load history", e);
        }
      }
    }
  }, [isLocked, startBatch]);

  useEffect(() => {
    localStorage.setItem('app_delay_seconds', delaySeconds.toString());
  }, [delaySeconds]);

  const [reviewQueue, setReviewQueue] = useState<SentencePair[]>([]);
  const [isReviewMode, setIsReviewMode] = useState(false);

  const handleAddToReview = useCallback((sentence: SentencePair) => {
    setReviewQueue(prev => {
      if (prev.some(s => s.english === sentence.english)) return prev;
      return [...prev, sentence];
    });
  }, []);

  const handleReviewComplete = useCallback(() => {
    setIsReviewMode(false);
    setReviewQueue([]);
  }, []);

  const handleSessionsAdd = useCallback((newSessions: DialogueSession[]) => {
    const fixedSessions = newSessions.map(ensureManageableDialogues);
    
    setPlaylist(prev => {
      const updatedPlaylist = [...prev, ...fixedSessions];
      if (!session) {
        const first = fixedSessions[0];
        setSession(first);
        localStorage.setItem(CURRENT_SESSION_ID_KEY, first.id);
        updateHistory(first);
        setState({ isLoading: true, error: null, data: null });
        startBatch(first);
      }
      return updatedPlaylist;
    });
  }, [session, startBatch, updateHistory]);

  const handleDeleteHistory = useCallback((id: string) => {
    setHistory(prev => {
      const filtered = prev.filter(s => s.id !== id);
      localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(filtered));
      return filtered;
    });
    if (session?.id === id) {
        setSession(null);
        setPlaylist(p => p.filter(s => s.id !== id));
        localStorage.removeItem(CURRENT_SESSION_ID_KEY);
    }
  }, [session]);

  const handleBatchComplete = useCallback(() => {
    if (!session || isReviewMode) return;
    
    const nextIndex = session.currentIndex + BATCH_SIZE;
    if (nextIndex >= session.allDialogues.length) {
      handleFinishedSession(session);
      return;
    }

    const updatedSession = { ...session, currentIndex: nextIndex, lastModified: Date.now() };
    setSession(updatedSession);
    updateHistory(updatedSession);
    startBatch(updatedSession);
  }, [session, isReviewMode, startBatch, updateHistory, handleFinishedSession]);

  const handleReset = () => {
    setSession(null);
    setPlaylist([]);
    localStorage.removeItem(CURRENT_SESSION_ID_KEY);
    setState({ isLoading: false, error: null, data: null });
  };

  const nextUp = playlist.findIndex(s => s.id === session?.id) + 1;
  const nextFile = playlist[nextUp];

  if (isLocked) return <PinLock onUnlock={() => setIsLocked(false)} />;

  return (
    <div className="min-h-screen bg-[#fafafa] font-sans pb-24 selection:bg-indigo-500 selection:text-white">
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <div className="bg-slate-900 rounded-2xl p-2.5 shadow-xl shadow-slate-100">
               <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className="w-5 h-5 text-white">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tighter leading-none mb-1 uppercase">SubShadow AI</h1>
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.3em] truncate max-w-[150px] sm:max-w-none">
                {session ? session.fileName : "Auto-Playlist Active"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
             {reviewQueue.length > 0 && !isReviewMode && (
               <button 
                 onClick={() => setIsReviewMode(true)}
                 className="bg-indigo-600 text-white px-5 py-2 rounded-2xl shadow-lg flex items-center gap-3 animate-in slide-in-from-right-4 active:scale-95 transition-all"
                >
                  <span className="text-[10px] font-black uppercase tracking-widest">Flagged: {reviewQueue.length}</span>
               </button>
             )}
             {session && (
               <button 
                 onClick={handleReset} 
                 className="p-3 text-slate-400 hover:text-indigo-600 transition-all rounded-full hover:bg-indigo-50"
                 title="Clear playlist"
               >
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
                  </svg>
               </button>
             )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {!session && !isReviewMode && (
            <SRTUpload 
                onSessionsAdd={handleSessionsAdd}
                history={history}
                onDeleteHistory={handleDeleteHistory}
                isLoading={state.isLoading}
                delaySeconds={delaySeconds}
                onDelaySecondsChange={setDelaySeconds}
            />
        )}

        {session && nextFile && (
          <div className="mb-6 flex justify-center">
            <div className="px-6 py-2 bg-indigo-50 rounded-full border border-indigo-100 flex items-center gap-3">
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Coming Up Next</span>
              <span className="text-[11px] font-bold text-indigo-600 truncate max-w-[200px]">{nextFile.fileName}</span>
            </div>
          </div>
        )}

        {state.error && (
          <div className="bg-white border-2 border-red-50 p-6 mb-10 rounded-[2rem] shadow-xl text-center animate-in shake duration-500">
            <p className="text-xs font-black text-red-600 uppercase tracking-wider">{state.error}</p>
          </div>
        )}

        <SentenceList 
          sentences={state.data} 
          isLoading={state.isLoading}
          onBatchComplete={handleBatchComplete}
          reviewQueue={reviewQueue}
          onAddToReview={handleAddToReview}
          isReviewMode={isReviewMode}
          onReviewComplete={handleReviewComplete}
          delaySeconds={delaySeconds}
        />
      </main>
    </div>
  );
};

export default App;