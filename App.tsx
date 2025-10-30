
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveSession, LiveServerMessage, Modality, Blob as GenAIBlob } from '@google/genai';


// --- REMOVED: AIStudio interface and declare global ---

interface ConversationMessage {
  sender: 'user' | 'ai';
  text: string;
}


// --- Helper Functions for Audio Processing (outside component to prevent re-creation) ---
function decode(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): GenAIBlob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
  
}
// --- End Helper Functions ---

const LOCAL_STORAGE_KEY = process.env.API_KEY;

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([]);
  const [currentInputTranscription, setCurrentInputTranscription] = useState<string>('');
  const [currentOutputTranscription, setCurrentOutputTranscription] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  
  // NEW STATE for API Key management
  const [apiKey, setApiKey] = useState<string>('');
  const hasApiKey = !!apiKey;

  const sessionRef = useRef<Promise<LiveSession> | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // Scroll to bottom of chat
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversationHistory, currentInputTranscription, currentOutputTranscription]);

  // Load API key from localStorage on mount
  useEffect(() => {
    const storedKey = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (storedKey) {
      setApiKey(storedKey);
    } 
  }, []);

  // Handler for API key input change
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newKey = e.target.value.trim();
    setApiKey(newKey);
    // Persist the key to localStorage
    if (newKey) {
        localStorage.setItem(LOCAL_STORAGE_KEY, newKey);
        setError(null); // Clear error if key is entered
    } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }

  const clearAudioPlayback = useCallback(() => {
    for (const source of outputSourcesRef.current.values()) {
      source.stop();
      source.disconnect();
  
    }
    outputSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleStartRecording = useCallback(async () => {
    setError(null);
    // Use hasApiKey state check
    if (!hasApiKey) {
      setError("Please enter your Gemini API key first.");
      return;
    }

    setIsLoading(true); // Indicate that something is happening (e.g., mic access, session setup)

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Use window.AudioContext
      inputAudioContextRef.current = new window.AudioContext({ sampleRate: 16000 });
      // Use window.AudioContext
      outputAudioContextRef.current = new window.AudioContext({ sampleRate: 24000 });

      mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
      // NOTE: ScriptProcessorNode is deprecated. For production, consider using AudioWorklet.
      scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

      scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
        const pcmBlob = createBlob(inputData);
        // CRITICAL: Solely rely on sessionPromise resolves and then call `session.sendRealtimeInput`
        sessionRef.current?.then((session) => {
          session.sendRealtimeInput({ media: pcmBlob });
        });
      };

      mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);

      // Use the state-managed API key
      const ai = new GoogleGenAI({ apiKey: apiKey });

      sessionRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            console.log('Live session opened.');
            setIsRecording(true);
            setIsLoading(false);
            setCurrentInputTranscription('');
            setCurrentOutputTranscription('');
            clearAudioPlayback(); // Clear any previous audio playback state
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              setCurrentOutputTranscription((prev) => prev + message.serverContent.outputTranscription.text);
            }
            if (message.serverContent?.inputTranscription) {
              setCurrentInputTranscription((prev) => prev + message.serverContent.inputTranscription.text);
            }

            if (message.serverContent?.turnComplete) {
              if (currentInputTranscription.trim()) {
                setConversationHistory((prev) => [
                  ...prev,
                  { sender: 'user', text: currentInputTranscription.trim() },
                ]);
              }
              if (currentOutputTranscription.trim()) {
                setConversationHistory((prev) => [
                  ...prev,
                  { sender: 'ai', text: currentOutputTranscription.trim() },
                ]);
              }
              setCurrentInputTranscription('');
              setCurrentOutputTranscription('');
            }

            // IMPORTANT: You must still handle the audio output.
            const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64EncodedAudioString && outputAudioContextRef.current) {
              nextStartTimeRef.current = Math.max(
                nextStartTimeRef.current,
                outputAudioContextRef.current.currentTime,
              );
              try {
                const audioBuffer = await decodeAudioData(
                  decode(base64EncodedAudioString),
                  outputAudioContextRef.current,
                  24000,
                  1,
                );
                const source = outputAudioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContextRef.current.destination); // Connect directly to destination
                source.addEventListener('ended', () => {
                  outputSourcesRef.current.delete(source);
                });
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;
                outputSourcesRef.current.add(source);
              } catch (audioDecodeError) {
                console.error("Error decoding audio data:", audioDecodeError);
                setError("Error playing AI response.");
              }
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              clearAudioPlayback();
            }
          },
          onerror: (e: ErrorEvent) => {
            console.error('Live session error:', e);
            if (e.message && e.message.includes("401 Unauthorized")) {
                setError("API key issue: Unauthorized. Please check your Gemini API key.");
            } else if (e.message && e.message.includes("Requested entity was not found.")) {
                setError("API key issue: Please check your Gemini API key. (ai.google.dev/gemini-api/docs/billing)");
            } else {
                setError("A session error occurred. Please try again.");
            }
            handleStopRecording(); // Stop recording on error
          },
          onclose: (e: CloseEvent) => {
            console.log('Live session closed:', e);
            handleStopRecording(); // Ensure recording state is reset
            if (!e.wasClean) {
              setError("Session closed unexpectedly. Please try again.");
            }
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }, // Choose a voice
          },
          systemInstruction: 'You are a friendly and helpful assistant. Keep your responses concise and natural for a voice conversation.',
        },
      });

    } catch (err) {
      console.error('Error starting recording:', err);
      setError(`Failed to start microphone or AI session: ${err instanceof Error ? err.message : String(err)}`);
      setIsLoading(false);
      setIsRecording(false);
      handleStopRecording(); // Ensure cleanup if initial setup fails
    }
  }, [hasApiKey, apiKey, clearAudioPlayback, currentInputTranscription, currentOutputTranscription]); // Dependencies updated

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setIsLoading(false); // Reset loading state when stopping
    clearAudioPlayback();

    // Close the live session
    sessionRef.current?.then((session) => {
      session.close();
      sessionRef.current = null;
    }).catch(e => console.error("Error closing session:", e));

    // Stop microphone track
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    // Disconnect and close audio contexts
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
      mediaStreamSourceRef.current.disconnect();
      mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close().catch(e => console.error("Error closing input audio context:", e));
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close().catch(e => console.error("Error closing output audio context:", e));
      outputAudioContextRef.current = null;
    }
  }, [clearAudioPlayback]);


  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      handleStopRecording();
    } else {
      handleStartRecording();
    }
  }, [isRecording, handleStartRecording, handleStopRecording]);


  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-indigo-600 text-white p-4 shadow-md flex flex-col sm:flex-row justify-between items-start sm:items-center">
        <h1 className="text-2xl font-bold mb-2 sm:mb-0">Realtime AI Voice Chat</h1>
        <div className="flex items-center w-full sm:w-auto">
            <label htmlFor="api-key-input" className="sr-only">Gemini API Key</label>
            <input
                id="api-key-input"
                type="password"
                placeholder={hasApiKey ? "API Key is set (Click Clear to change)" : "Enter Gemini API Key"}
                value={apiKey}
                onChange={handleApiKeyChange}
                className="w-full sm:w-80 px-3 py-1 text-sm text-gray-800 rounded-l-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-white"
            />
            <button
                onClick={() => setApiKey('')}
                className="px-3 py-1 bg-white text-indigo-700 rounded-r-lg shadow hover:bg-gray-100 transition-colors duration-200 text-sm h-full"
                title="Clear API Key from local storage"
            >
                {hasApiKey ? 'Clear' : 'Set'}
            </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-4 space-y-4">
        {conversationHistory.length === 0 && !currentInputTranscription && !currentOutputTranscription && (
          <div className="text-center text-gray-500 mt-10">
            <p className="text-lg">Start a real-time voice conversation with the AI.</p>
            <p className="text-sm">
                First, enter your Gemini API key in the header.
            </p>
            <p className="text-sm mt-1">
                Then, click the microphone button below to begin.
            </p>
          </div>
        )}

        {conversationHistory.map((msg, index) => (
          <div
            key={index}
            className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`p-3 rounded-lg max-w-[80%] shadow-md ${
                msg.sender === 'user'
                  ? 'bg-blue-500 text-white rounded-br-none'
                  : 'bg-white text-gray-800 rounded-bl-none'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {currentInputTranscription && (
          <div className="flex justify-end">
            <div className="p-3 rounded-lg max-w-[80%] bg-blue-100 text-blue-800 rounded-br-none italic">
              {currentInputTranscription}
            </div>
          </div>
        )}
        {currentOutputTranscription && (
          <div className="flex justify-start">
            <div className="p-3 rounded-lg max-w-[80%] bg-gray-100 text-gray-700 rounded-bl-none italic">
              {currentOutputTranscription}
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </main>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 text-center font-medium">
          {error}
        </div>
      )}

      <footer className="sticky bottom-0 bg-white p-4 shadow-lg border-t border-gray-200 flex flex-col items-center">
        <button
          onClick={handleToggleRecording}
          disabled={isLoading || !hasApiKey}
          className={`
            w-16 h-16 rounded-full flex items-center justify-center
            transition-all duration-300 ease-in-out
            focus:outline-none focus:ring-4
            ${isRecording
              ? 'bg-red-500 hover:bg-red-600 focus:ring-red-300 transform scale-105 active:scale-100'
              : 'bg-indigo-600 hover:bg-indigo-700 focus:ring-indigo-300'
            }
            ${isLoading || !hasApiKey ? 'opacity-60 cursor-not-allowed' : ''}
          `}
        >
          {isLoading ? (
            <svg className="animate-spin h-8 w-8 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : (
            <svg
              className={`w-8 h-8 ${isRecording ? 'text-white' : 'text-white'}`}
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                fillRule="evenodd"
                d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z"
                clipRule="evenodd"
              ></path>
            </svg>
          )}
        </button>
        
        {isRecording && (
          <p className="text-sm text-gray-600 mt-2">
            Speak now...
          </p>
        )}
        {!isRecording && !isLoading && (
          <p className="text-sm text-gray-600 mt-2">
            {hasApiKey ? 'Click to start conversation' : 'Enter API Key to enable recording'}
          </p> 
        )}
        
      </footer>
      
    </div>
  );
   

 
};


export default App;