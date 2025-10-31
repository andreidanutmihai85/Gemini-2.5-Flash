import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
// The LiveSession type is not exported from @google/genai, using 'any' as a workaround.
import { SessionStatus } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audio';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

export const useGeminiLive = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.Idle);
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  
  const outputSources = useRef<Set<AudioBufferSourceNode>>(new Set()).current;
  const nextStartTime = useRef(0);

  // Polls the audio context to determine if audio is actively playing or queued.
  // This provides a much more accurate state for `isSpeaking` than a simple timeout.
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (status === SessionStatus.Listening && outputAudioContextRef.current) {
        // The AI is "speaking" if the next audio chunk is scheduled to start in the future.
        const isCurrentlySpeaking = nextStartTime.current > outputAudioContextRef.current.currentTime;
        // Only update state if it has changed to avoid unnecessary re-renders.
        setIsSpeaking(prev => prev === isCurrentlySpeaking ? prev : isCurrentlySpeaking);
      } else {
        // If we are not in a listening state, ensure isSpeaking is false.
        setIsSpeaking(prev => prev ? false : prev);
      }
    }, 200); // Check every 200ms.

    return () => clearInterval(intervalId); // Clean up the interval on unmount.
  }, [status]);


  const stopSession = useCallback(async () => {
    if (sessionPromiseRef.current) {
      try {
        const session = await sessionPromiseRef.current;
        session.close();
      } catch(e) {
        console.error("Error closing session:", e);
      } finally {
        sessionPromiseRef.current = null;
      }
    }
    
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    mediaStreamSourceRef.current?.disconnect();
    mediaStreamSourceRef.current = null;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    if (inputAudioContextRef.current?.state !== 'closed') inputAudioContextRef.current?.close();
    if (outputAudioContextRef.current?.state !== 'closed') outputAudioContextRef.current?.close();

    outputSources.forEach(source => source.stop());
    outputSources.clear();
    nextStartTime.current = 0;

    setIsSpeaking(false);
    setStatus(SessionStatus.Idle);
  }, []);

  const startSession = useCallback(async (apiKey?: string) => {
    setError(null);
    setStatus(SessionStatus.Connecting);
    setIsSpeaking(false);

    try {
      // Use the provided API key, or fall back to the environment variable.
      const keyToUse = apiKey || process.env.API_KEY;
      if (!keyToUse) {
        throw new Error("API key not found. Please select or enter an API key.");
      }

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser.');
      }

      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

      const ai = new GoogleGenAI({ apiKey: keyToUse });
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: 'You are a friendly and helpful AI assistant. Keep your responses concise and conversational.',
        },
        callbacks: {
          onopen: () => {
            if (!inputAudioContextRef.current || !mediaStreamRef.current) return;
            setStatus(SessionStatus.Listening);
            mediaStreamSourceRef.current = inputAudioContextRef.current.createMediaStreamSource(mediaStreamRef.current);
            scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(BUFFER_SIZE, 1, 1);
            
            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              if (sessionPromiseRef.current) {
                sessionPromiseRef.current.then((session) => {
                  session.sendRealtimeInput({ media: pcmBlob });
                });
              }
            };
            
            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
            scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            // Handle audio playback
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, OUTPUT_SAMPLE_RATE, 1);
                const source = outputAudioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContextRef.current.destination);

                source.addEventListener('ended', () => outputSources.delete(source));
                
                const currentTime = outputAudioContextRef.current.currentTime;
                // Schedule the new audio to play right after the previous one finishes.
                nextStartTime.current = Math.max(nextStartTime.current, currentTime);
                source.start(nextStartTime.current);
                // Update the time for the next audio chunk.
                nextStartTime.current += audioBuffer.duration;
                outputSources.add(source);
            }

            if(message.serverContent?.interrupted){
                for(const source of outputSources.values()){
                    source.stop();
                    outputSources.delete(source);
                }
                nextStartTime.current = 0;
            }

          },
          onerror: (e: ErrorEvent) => {
            console.error('Session error:', e);
            setError(`Session error: ${e.message}`);
            setStatus(SessionStatus.Error);
            stopSession();
          },
          onclose: () => {
             stopSession();
          },
        },
      });
    } catch (e: any) {
      console.error('Failed to start session:', e);
      setError(`Failed to start: ${e.message}`);
      setStatus(SessionStatus.Error);
    }
  }, [stopSession]);

  return { status, error, startSession, stopSession, isSpeaking };
};