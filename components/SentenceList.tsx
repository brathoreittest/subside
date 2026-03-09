import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { SentencePair } from '../types';

interface SentenceListProps {
  sentences: SentencePair[] | null;
  isLoading: boolean;
  onBatchComplete: () => void;
  reviewQueue: SentencePair[];
  onAddToReview: (sentence: SentencePair) => void;
  isReviewMode: boolean;
  onReviewComplete: () => void;
  delaySeconds: number;
}

const SentenceList: React.FC<SentenceListProps> = ({ 
  sentences, 
  isLoading, 
  onBatchComplete,
  reviewQueue,
  onAddToReview,
  isReviewMode,
  onReviewComplete,
  delaySeconds
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showEnglish, setShowEnglish] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [notif, setNotif] = useState<string | null>(null);
  
  const wakeLockRef = useRef<any>(null);

  const activeSentences = isReviewMode ? reviewQueue : (sentences || []);

  // Screen Wake Lock Logic
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch (err: any) {
        if (err.name !== 'NotAllowedError') {
          console.warn(`WakeLock failed: ${err.name}, ${err.message}`);
        }
      }
    }
  };

  const releaseWakeLock = useCallback(async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      } catch (err: any) {
        console.error(`${err.name}, ${err.message}`);
      }
    }
  }, []);

  useEffect(() => {
    if (!isLoading && activeSentences.length > 0 && !isPaused) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && !isPaused && !isLoading && activeSentences.length > 0) {
        await requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [isLoading, isPaused, activeSentences.length, releaseWakeLock]);

  useEffect(() => {
    setCurrentIndex(0);
    setShowEnglish(false);
    setProgress(0);
    setIsPaused(false);
  }, [isReviewMode, sentences]);

  const speak = (text: string, lang: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang;
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };

  const handleNext = useCallback(() => {
    if (currentIndex < activeSentences.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowEnglish(false);
      setProgress(0);
    } else {
      if (isReviewMode) onReviewComplete();
      else onBatchComplete();
    }
  }, [currentIndex, activeSentences, isReviewMode, onReviewComplete, onBatchComplete]);

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setShowEnglish(false);
      setProgress(0);
    }
  };

  const handleFlag = () => {
    const current = activeSentences[currentIndex];
    if (current) {
        onAddToReview(current);
        setNotif("Saved for review");
        setTimeout(() => setNotif(null), 1500);
    }
  };

  // Logic: Delay = WordCount + Buffer (delaySeconds)
  const currentSentenceDelay = useMemo(() => {
    const currentPair = activeSentences[currentIndex];
    if (!currentPair) return delaySeconds;
    
    const wordCount = currentPair.english.split(/\s+/).filter(w => w.length > 0).length;
    // Example: 6 words + 4s buffer = 10s total.
    return wordCount + delaySeconds;
  }, [currentIndex, activeSentences, delaySeconds]);

  useEffect(() => {
    if (isLoading || activeSentences.length === 0 || isPaused) return;
    const currentPair = activeSentences[currentIndex];
    if (!currentPair) return;
    
    const timer = setTimeout(() => {
        showEnglish ? speak(currentPair.english, 'en-US') : speak(currentPair.hindi, 'hi-IN');
    }, 150);
    return () => {
        clearTimeout(timer);
        window.speechSynthesis.cancel();
    };
  }, [currentIndex, showEnglish, activeSentences, isPaused, isLoading]);

  useEffect(() => {
    if (isLoading || activeSentences.length === 0 || isPaused) return;

    let timer: ReturnType<typeof setTimeout>;
    const interval = 50;
    let elapsed = 0;
    // We use the dynamic delay calculated for this specific sentence
    const totalDuration = currentSentenceDelay * 1000;
    
    const progressTimer = setInterval(() => {
        elapsed += interval;
        setProgress(Math.min((elapsed / totalDuration) * 100, 100));
    }, interval);

    if (!showEnglish) {
      // Phase 1: Show Hindi, wait for Repeat
      timer = setTimeout(() => {
        setShowEnglish(true);
        setProgress(0); 
      }, totalDuration);
    } else {
      // Phase 2: Show English, wait for Confirmation/Next
      timer = setTimeout(() => {
        handleNext();
      }, totalDuration);
    }

    return () => {
      clearTimeout(timer);
      clearInterval(progressTimer);
    };
  }, [currentIndex, showEnglish, currentSentenceDelay, activeSentences, isLoading, isPaused, handleNext]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[450px] bg-white rounded-[3rem] border border-slate-100 shadow-sm animate-pulse">
        <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-6"></div>
        <p className="text-indigo-600 font-black uppercase tracking-[0.3em] text-[10px]">Translating dialogues...</p>
      </div>
    );
  }

  if (activeSentences.length === 0) return null;

  const currentPair = activeSentences[currentIndex];

  return (
    <div className="w-full max-w-3xl mx-auto animate-in fade-in duration-500">
        <div className="flex justify-between items-center mb-8 px-6">
            <div className="flex items-center gap-4">
                 <div className="bg-white border-2 border-slate-100 px-6 py-2.5 rounded-2xl shadow-sm">
                    <span className="text-base font-black text-slate-900">
                        {currentIndex + 1} <span className="text-slate-200">/</span> {activeSentences.length}
                    </span>
                 </div>
                 
                 <button
                    onClick={() => setIsPaused(!isPaused)}
                    className={`h-11 px-8 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all border-2 ${
                        isPaused 
                            ? 'bg-amber-500 text-white border-amber-600' 
                            : 'bg-white text-slate-600 border-slate-100 hover:border-slate-300'
                    }`}
                 >
                    {isPaused ? "Paused" : "Playing"}
                 </button>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest mr-2">
                Pace: {currentSentenceDelay}s
              </span>
              <div className="flex gap-3">
                <button onClick={handleFlag} className="p-4 bg-white border-2 border-slate-100 rounded-2xl hover:bg-slate-50 active:scale-90 transition-all text-slate-300">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" className="w-5 h-5">
                    <path d="M3 2v20h2v-8h3c1.25 0 2.5-1 2.5-2.5S9.25 9 8 9H5V2H3zm5 10H5v-1h3c.28 0 .5.22.5.5s-.22.5-.5.5z"/>
                  </svg>
                </button>
                <button onClick={handlePrev} className="p-4 bg-white border-2 border-slate-100 rounded-2xl hover:bg-slate-50 active:scale-90 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 text-slate-200">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                </button>
                <button onClick={handleNext} className="p-4 bg-white border-2 border-slate-100 rounded-2xl hover:bg-slate-50 active:scale-90 transition-all">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={4} stroke="currentColor" className="w-5 h-5 text-indigo-600">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                </button>
              </div>
            </div>
        </div>

        <div className={`relative bg-white rounded-[3.5rem] shadow-2xl border border-slate-100 overflow-hidden min-h-[500px] flex flex-col transition-all duration-500 ${isPaused ? 'opacity-60 scale-[0.99]' : 'opacity-100'}`}>
            <div className="h-3 w-full bg-slate-50">
                <div 
                    className="h-full transition-all ease-linear bg-indigo-600"
                    style={{ width: `${progress}%` }}
                ></div>
            </div>
            
            <div className="flex-1 flex flex-col items-center justify-center p-14 text-center space-y-16">
                <div className="w-full">
                    <span className="inline-block px-5 py-2 rounded-xl bg-slate-50 text-slate-400 text-[9px] font-black uppercase tracking-[0.2em] mb-8">
                        Hindi Translation
                    </span>
                    <h2 className="text-5xl sm:text-6xl font-black text-slate-900 leading-tight tracking-tight">
                        {currentPair?.hindi}
                    </h2>
                </div>

                <div className={`transition-all duration-700 transform w-full ${showEnglish ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="flex items-center gap-6 justify-center mb-8">
                      <div className="h-px w-10 bg-slate-100"></div>
                      <span className="inline-block px-5 py-2 rounded-xl bg-indigo-50 text-indigo-700 text-[9px] font-black uppercase tracking-[0.2em]">
                          Original Script
                      </span>
                      <div className="h-px w-10 bg-slate-100"></div>
                    </div>
                    <p className="text-3xl sm:text-4xl text-slate-400 font-bold leading-tight italic">
                        "{currentPair?.english}"
                    </p>
                </div>
            </div>

            {notif && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-20 bg-slate-900 text-white text-[10px] font-black px-8 py-3 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-4">
                    {notif}
                </div>
            )}
        </div>
        
        <div className="mt-12 flex flex-col items-center justify-center gap-2">
            <p className="text-slate-300 text-[9px] font-black uppercase tracking-[0.4em]">
                {isPaused ? "Shadowing Paused" : (showEnglish ? "Listen & Repeat..." : "Prepare to translate...")}
            </p>
        </div>
    </div>
  );
};

export default SentenceList;