import { GoogleGenAI, Type } from "@google/genai";
import { SentencePair, SentenceResponse } from "../types";



/**
 * Translates a batch of English dialogues into natural, conversational Hindi.
 * Uses index-based objects to guarantee 100% order accuracy.
 */
export const processTranscriptBatch = async (sentences: string[]): Promise<SentenceResponse> => {
  const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API Key is missing. Please ensure GEMINI_API_KEY is set in your environment.");
  }
  const ai = new GoogleGenAI({ apiKey });
  
  const cleanSentences = sentences.map(s => 
    s.replace(/(\d{1,2}:)+\d+(\s*seconds)?/gi, '').replace(/\s+/g, ' ').trim()
  ).filter(s => s.length > 0);

  if (cleanSentences.length === 0) {
    return { data: [], usage: { promptTokens: 0, candidatesTokens: 0, totalTokens: 0 } };
  }

  // Detect if the input is primarily Hindi
  const hindiCharCount = cleanSentences.join('').split('').filter(char => /[\u0900-\u097F]/.test(char)).length;
  const isInputHindi = hindiCharCount > (cleanSentences.join('').length * 0.2); // 20% threshold for Hindi detection

  const prompt = isInputHindi 
    ? `Translate these ${cleanSentences.length} Hindi dialogues into natural conversational English.
    
    Dialogues:
    ${cleanSentences.map((s, i) => `ID ${i}: ${s}`).join('\n')}
    
    RULES:
    1. Return an array of objects: { "id": number, "translated": string }.
    2. The "id" MUST match the index provided above (0 to ${cleanSentences.length - 1}).
    3. The "translated" string must be a natural English translation.
    4. Maintain the EXACT sequence of IDs.
    5. NO placeholders like "unavailable" or "..."
    6. DO NOT include any timestamps, timecodes, or IDs in the "translated" text.`
    : `Translate these ${cleanSentences.length} dialogues into natural conversational Hindi.
    
    Dialogues:
    ${cleanSentences.map((s, i) => `ID ${i}: ${s}`).join('\n')}
    
    RULES:
    1. Return an array of objects: { "id": number, "translated": string }.
    2. The "id" MUST match the index provided above (0 to ${cleanSentences.length - 1}).
    3. The "translated" string must be a natural Hindi translation.
    4. Maintain the EXACT sequence of IDs.
    5. NO placeholders like "unavailable" or "..."
    6. Keep all nouns (names, places, technical terms, specific objects) in their original English form.
    7. DO NOT include any timestamps, timecodes, or IDs in the "translated" text.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.INTEGER },
              translated: { type: Type.STRING }
            },
            required: ["id", "translated"]
          }
        },
        systemInstruction: isInputHindi 
          ? "You are a film dialogue translator. You provide precise, chronological English translations for Hindi text. You always return the requested JSON structure with matching IDs."
          : "You are a film dialogue translator. You provide precise, chronological Hindi translations. IMPORTANT: Keep all nouns (names, places, specific objects) in their original English form within the Hindi translation. You always return the requested JSON structure with matching IDs.",
        temperature: 0.1,
      },
    });

    if (!response.text) {
      throw new Error("Empty response from AI model");
    }

    const text = response.text.trim();
    let translatedItems: { id: number, translated: string }[] = [];
    
    try {
      translatedItems = JSON.parse(text);
    } catch (e) {
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      translatedItems = JSON.parse(cleaned);
    }

    if (!Array.isArray(translatedItems)) {
      throw new Error("Invalid response format: expected an array");
    }

    translatedItems.sort((a, b) => a.id - b.id);

    const validatedData: SentencePair[] = cleanSentences.map((original, idx) => {
      const translated = translatedItems.find(item => item.id === idx);
    const translatedText = (translated?.translated || "").trim()
      // Remove any leaked timestamps like "0:022 seconds" or "1:23"
      .replace(/(\d{1,2}:)+\d+(\s*seconds)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
      
      return {
        english: isInputHindi ? translatedText : original,
        hindi: isInputHindi ? original : translatedText
      };
    }).filter(pair => {
      const targetText = isInputHindi ? pair.english : pair.hindi;
      return targetText && targetText.length > 1 && !targetText.includes("अनुवाद");
    });

    if (validatedData.length === 0 && sentences.length > 0) {
        console.warn("All translations were filtered out for batch:", sentences);
    }

    return {
      data: validatedData,
      usage: {
        promptTokens: 0,
        candidatesTokens: 0,
        totalTokens: 0
      }
    };
  } catch (error: any) {
    console.error("Translation error:", error);
    throw error; // Throw so the UI can catch and display the error
  }
};