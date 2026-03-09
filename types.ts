export interface SentencePair {
  english: string;
  hindi: string;
}

export interface UsageStats {
  promptTokens: number;
  candidatesTokens: number;
  totalTokens: number;
}

export interface SentenceResponse {
  data: SentencePair[];
  usage: UsageStats;
}

export interface DialogueSession {
  id: string;
  fileName: string;
  allDialogues: string[];
  currentIndex: number;
  lastModified: number;
}

export interface GenerationState {
  isLoading: boolean;
  error: string | null;
  data: SentencePair[] | null;
}