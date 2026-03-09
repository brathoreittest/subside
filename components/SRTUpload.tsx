import React, { useCallback } from 'react';
import { DialogueSession } from '../types';

interface SRTUploadProps {
  onSessionsAdd: (sessions: DialogueSession[]) => void;
  history: DialogueSession[];
  onDeleteHistory: (id: string) => void;
  isLoading: boolean;
  delaySeconds: number;
  onDelaySecondsChange: (val: number) => void;
}

const DELAY_OPTIONS = [2, 4, 6, 8, 10, 12];

/**
 * Checks if a string contains meaningful alphanumeric content.
 */
const isMeaningful = (text: string) => /[a-zA-Z0-9\u0900-\u097F]/.test(text);

/**
 * Checks if the text has at least two words.
 */
const hasMultipleWords = (text: string) => {
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  return words.length > 1;
};

/**
 * Split a single long thought into manageable chunks.
 * Optimized to ensure segments are natural and practice-friendly.
 */
export const splitByLength = (text: string): string[] => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const MIN_WORDS = 4;    // Avoid fragments that are too short
  const TARGET_CHUNK = 10; 
  const MAX_WORDS = 16;   // Upper limit for shadowing
  
  if (words.length <= MAX_WORDS) return [text];

  const result: string[] = [];
  let startIndex = 0;

  while (startIndex < words.length) {
    const remaining = words.length - startIndex;
    
    // If remaining words are within a reasonable range, just take the rest
    if (remaining <= MAX_WORDS) {
      const chunk = words.slice(startIndex).join(' ');
      if (chunk.trim()) result.push(chunk);
      break;
    }

    let cutIndex = startIndex + TARGET_CHUNK;
    
    // Look for natural break points (commas, conjunctions, etc.)
    let bestBreak = -1;
    // Search in a window around the target chunk size
    for (let i = cutIndex - 4; i <= cutIndex + 4; i++) {
      if (i < words.length && i > startIndex + MIN_WORDS) {
        const w = words[i - 1]; // Check the word BEFORE the potential cut
        const nextW = words[i];
        
        // High priority: Punctuation
        if (w.endsWith(',') || w.endsWith(';') || w.endsWith(':') || w.endsWith('--')) {
          bestBreak = i;
          break; // Found a great break point
        }
        
        // Medium priority: Conjunctions and prepositions
        if (/^(and|but|or|so|because|that|which|when|where|if|then|although|while|with|from|about|into)$/i.test(nextW)) {
          bestBreak = i;
        }
      }
    }

    if (bestBreak !== -1) {
      cutIndex = bestBreak;
    }

    // Ensure we don't leave a tiny fragment at the end
    const leftover = words.length - cutIndex;
    if (leftover > 0 && leftover < MIN_WORDS) {
        cutIndex = words.length;
    }

    const chunk = words.slice(startIndex, cutIndex).join(' ');
    if (chunk.trim()) {
      result.push(chunk);
    }
    startIndex = cutIndex;
  }

  return result;
};

const SRTUpload: React.FC<SRTUploadProps> = ({ 
  onSessionsAdd, history, onDeleteHistory, isLoading, delaySeconds, onDelaySecondsChange 
}) => {
  
  const parseSRT = (text: string): string[] => {
    // Normalize line endings
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    
    // 1. Try standard SRT parsing first
    // Split by double newline or triple newline to be safe
    const srtBlocks = normalizedText.trim().split(/\n\n+/);
    const srtDialogues: { time: number, text: string }[] = [];

    if (normalizedText.includes('-->')) {
      srtBlocks.forEach(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 1) return;

        // Find the line with the timestamp
        const timeLineIndex = lines.findIndex(l => l.includes('-->'));
        if (timeLineIndex === -1) return;

        // Extract start time
        const timeMatch = lines[timeLineIndex].match(/(\d{1,2}:\d{2}:\d{2})/);
        if (!timeMatch) return;

        const timeParts = timeMatch[1].split(':').map(Number);
        const seconds = timeParts[0] * 3600 + timeParts[1] * 60 + timeParts[2];

        // Content is everything after the timeline
        const content = lines.slice(timeLineIndex + 1).join(' ').replace(/<[^>]*>/g, '').trim();
        if (content && isMeaningful(content)) {
          srtDialogues.push({ time: seconds, text: content });
        }
      });
    }

    if (srtDialogues.length > 0) {
      srtDialogues.sort((a, b) => a.time - b.time);
      return processRawText(srtDialogues.map(d => d.text).join(' '));
    }

    // 2. Fallback: Handle transcript style (Timestamp line followed by text)
    // Example: 0:00 \n Text \n 0:14 \n Text
    const lines = text.split(/\r?\n/);
    const transcriptDialogues: string[] = [];
    let currentText = "";

    lines.forEach(line => {
      const trimmed = line.trim();
      // Match 0:00, 00:00, 1:00:00, 0:022 seconds, etc.
      const isTimestamp = /^(\d{1,2}:)+\d+(\s*seconds)?$/i.test(trimmed);
      
      if (isTimestamp) {
        if (currentText) {
          transcriptDialogues.push(currentText.trim());
          currentText = "";
        }
      } else if (trimmed) {
        currentText += " " + trimmed;
      }
    });
    if (currentText) transcriptDialogues.push(currentText.trim());

    if (transcriptDialogues.length > 0) {
      return processRawText(transcriptDialogues.join(' '));
    }

    // 3. Last resort: Just treat as raw text
    return processRawText(text);
  };

  const processRawText = (fullText: string): string[] => {
    const cleanedText = fullText
      // Remove standard SRT timestamps if they leaked in
      .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{3}/g, ' ')
      // Remove transcript style timestamps (0:00, 00:00, 1:23:45, 0:022 seconds, etc.)
      .replace(/(\d{1,2}:)+\d+(\s*seconds)?/gi, ' ')
      .replace(/>>\s*/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Smarter sentence splitting: avoid splitting on common abbreviations
    // This regex looks for .?! or Hindi Purna Viram followed by space
    const abbreviations = ['Mr', 'Ms', 'Mrs', 'Dr', 'Prof', 'St', 'Ave', 'Rd', 'Gen', 'Capt', 'Col', 'Lt'];
    const abbrRegex = new RegExp(`\\b(${abbreviations.join('|')})\\.$`, 'i');

    // Split on .?! or Hindi । followed by space
    const rawSentences = cleanedText.split(/(?<=[.?!।])\s+/);
    const mergedSentences: string[] = [];
    
    let buffer = "";
    rawSentences.forEach(s => {
      const current = (buffer ? buffer + " " : "") + s.trim();
      const lastWord = current.split(/\s+/).pop() || "";
      
      // If the "sentence" ends with an abbreviation, don't split yet
      if (abbrRegex.test(lastWord)) {
        buffer = current;
      } else {
        mergedSentences.push(current);
        buffer = "";
      }
    });
    if (buffer) mergedSentences.push(buffer);

    const finalDialogues: string[] = [];

    mergedSentences.forEach(sentence => {
      const trimmed = sentence.trim();
      if (!trimmed || !isMeaningful(trimmed)) return;
      
      const words = trimmed.split(/\s+/).filter(w => w.length > 0);
      
      // If sentence is too short (e.g. "Oh.", "Yes."), try to merge it with the next one
      // but only if it's not the last sentence.
      if (words.length < 3 && finalDialogues.length > 0) {
          const lastIdx = finalDialogues.length - 1;
          const lastWords = finalDialogues[lastIdx].split(/\s+/).length;
          if (lastWords + words.length <= 16) {
              finalDialogues[lastIdx] = finalDialogues[lastIdx] + " " + trimmed;
              return;
          }
      }

      if (words.length <= 16) {
        finalDialogues.push(trimmed);
      } else {
        finalDialogues.push(...splitByLength(trimmed));
      }
    });

    return finalDialogues.filter(c => isMeaningful(c));
  };

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const sessionPromises = Array.from(files).map((file: File) => {
      return new Promise<DialogueSession | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const content = event.target?.result as string;
          const parsedDialogues = parseSRT(content);
          
          if (parsedDialogues.length === 0) {
            resolve(null);
          } else {
            resolve({
              id: crypto.randomUUID(),
              fileName: file.name,
              allDialogues: parsedDialogues,
              currentIndex: 0,
              lastModified: Date.now()
            });
          }
        };
        reader.onerror = () => resolve(null);
        reader.readAsText(file);
      });
    });

    const newSessions = (await Promise.all(sessionPromises)).filter((s): s is DialogueSession => s !== null);
    
    if (newSessions.length === 0) {
      alert("Could not extract meaningful dialogues from any of the selected files.");
      return;
    }

    onSessionsAdd(newSessions);
    e.target.value = '';
  }, [onSessionsAdd]);

  return (
    <div className="flex flex-col gap-8 mb-8">
      <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 p-8">
        <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 text-center underline decoration-indigo-500/30 underline-offset-8">Load Movie Scripts (.srt)</label>
        <div className="relative group cursor-pointer mb-8">
          <input 
            type="file" 
            accept=".srt"
            multiple
            onChange={handleFileChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            disabled={isLoading}
          />
          <div className={`w-full py-12 border-2 border-dashed border-slate-200 rounded-[2rem] flex flex-col items-center justify-center transition-all group-hover:border-indigo-400 group-hover:bg-indigo-50/30 ${isLoading ? 'opacity-50' : ''}`}>
             <div className="w-16 h-16 bg-indigo-100 rounded-3xl flex items-center justify-center text-indigo-600 mb-5 shadow-inner">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-7 h-7">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
             </div>
             <p className="text-base font-black text-slate-900 uppercase tracking-tight">Upload Multiple Files</p>
             <p className="text-[10px] text-slate-400 font-bold mt-1 tracking-widest uppercase text-center">Optimized Chunking Active</p>
          </div>
        </div>

        <div className="border-t border-slate-100 pt-8">
            <div className="flex flex-col items-center mb-5">
              <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">Base Buffer</label>
              <p className="text-[9px] text-indigo-500 font-bold uppercase mt-1 tracking-wider">Delay = Words + Buffer</p>
            </div>
            <div className="grid grid-cols-6 gap-3">
            {DELAY_OPTIONS.map(s => (
                <button
                key={s}
                onClick={() => onDelaySecondsChange(s)}
                className={`py-3 rounded-2xl text-xs font-black transition-all border-2 ${
                    delaySeconds === s 
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xl' 
                    : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                }`}
                >
                +{s}s
                </button>
            ))}
            </div>
        </div>
      </div>

      {history.length > 0 && (
        <div className="bg-white rounded-[2.5rem] shadow-sm border border-slate-200 p-8">
            <label className="block text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 text-center">Recently Played ({history.length}/10)</label>
            <div className="grid grid-cols-1 gap-3">
                {history.map(item => {
                    const progress = Math.round((item.currentIndex / item.allDialogues.length) * 100);
                    return (
                        <div 
                            key={item.id}
                            className="group relative flex items-center justify-between p-5 bg-slate-50 border border-slate-100 rounded-[1.5rem] hover:border-indigo-200 transition-all cursor-pointer"
                            onClick={() => onSessionsAdd([item])}
                        >
                            <div className="flex items-center gap-4 flex-1">
                                <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 shadow-sm">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
                                    </svg>
                                </div>
                                <div>
                                    <h4 className="text-sm font-black text-slate-900 truncate max-w-[200px] uppercase tracking-tight">{item.fileName}</h4>
                                    <div className="flex items-center gap-3 mt-1">
                                        <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }}></div>
                                        </div>
                                        <span className="text-[9px] font-black text-slate-400 uppercase">{progress}% Complete</span>
                                    </div>
                                </div>
                            </div>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteHistory(item.id);
                                }}
                                className="p-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
      )}
    </div>
  );
};

export default SRTUpload;