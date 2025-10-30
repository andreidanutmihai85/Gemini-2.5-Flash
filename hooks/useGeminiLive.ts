import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { SessionStatus, Speaker, TranscriptEntry } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audio';

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

export const useGeminiLive = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.Idle);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  // FIX: LiveSession is not an exported type. Use `any` or let TypeScript infer.
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const outputSources = useRef<Set<AudioBufferSourceNode>>(new Set()).current;
  const nextStartTime = useRef(0);

  const stopSession = useCallback(async () => {
    if (sessionPromiseRef.current) {
      try {
        const session = await sessionPromiseRef.current;
        session.close();
      } catch (e) {
        // Ignore errors during close
      }
      sessionPromiseRef.current = null;
    }
    
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;
    mediaStreamSourceRef.current?.disconnect();
    mediaStreamSourceRef.current = null;
    
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    mediaStreamRef.current = null;

    inputAudioContextRef.current?.close().catch(() => {});
    outputAudioContextRef.current?.close().catch(() => {});

    outputSources.forEach(source => source.stop());
    outputSources.clear();
    nextStartTime.current = 0;

    setStatus(SessionStatus.Idle);
  }, []);

  const startSession = useCallback(async () => {
    setError(null);
    setStatus(SessionStatus.Connecting);
    setTranscript([]);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser.');
      }

      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Fix: Cast window to any to allow access to vendor-prefixed webkitAudioContext for cross-browser compatibility.
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: INPUT_SAMPLE_RATE });
      // Fix: Cast window to any to allow access to vendor-prefixed webkitAudioContext for cross-browser compatibility.
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: OUTPUT_SAMPLE_RATE });

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      sessionPromiseRef.current = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          systemInstruction: 'You are a friendly and helpful AI assistant. Keep your responses concise and conversational.',
          inputAudioTranscription: {},
          outputAudioTranscription: {},
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
            // FIX: The `isFinal` property does not exist on the Transcription object.
            // We manage transcript finality based on the `turnComplete` event.
            // Handle transcript updates
            if (message.serverContent?.inputTranscription) {
                const { text } = message.serverContent.inputTranscription;
                setTranscript(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.speaker === Speaker.User && !last.isFinal) {
                        const updated = [...prev];
                        updated[prev.length - 1] = { ...last, text: last.text + text };
                        return updated;
                    }
                    return [...prev, { speaker: Speaker.User, text, isFinal: false }];
                });
            }
            if (message.serverContent?.outputTranscription) {
                const { text } = message.serverContent.outputTranscription;
                setTranscript(prev => {
                    const last = prev[prev.length - 1];
                    if (last?.speaker === Speaker.AI && !last.isFinal) {
                        const updated = [...prev];
                        updated[prev.length - 1] = { ...last, text: last.text + text };
                        return updated;
                    }
                    return [...prev, { speaker: Speaker.AI, text, isFinal: false }];
                });
            }

            // Handle audio playback
            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current, OUTPUT_SAMPLE_RATE, 1);
                const source = outputAudioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContextRef.current.destination);

                source.addEventListener('ended', () => outputSources.delete(source));
                
                const currentTime = outputAudioContextRef.current.currentTime;
                nextStartTime.current = Math.max(nextStartTime.current, currentTime);
                source.start(nextStartTime.current);
                nextStartTime.current += audioBuffer.duration;
                outputSources.add(source);
            }
            
            if (message.serverContent?.turnComplete) {
                setTranscript(prev =>
                    prev.map(entry =>
                        entry.isFinal ? entry : { ...entry, isFinal: true }
                    )
                );
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
             // Session closed by server
          },
        },
      });
    } catch (e: any) {
      console.error('Failed to start session:', e);
      setError(`Failed to start: ${e.message}`);
      setStatus(SessionStatus.Error);
    }
  }, [stopSession]);

  return { status, transcript, error, startSession, stopSession };
};
