
import React, { useState, useEffect, useRef } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { SessionStatus, Speaker, TranscriptEntry } from './types';
import { MicrophoneIcon, StopIcon, LoadingSpinner } from './components/Icons';

const StatusIndicator: React.FC<{ status: SessionStatus }> = ({ status }) => {
  const statusInfo = {
    [SessionStatus.Idle]: { text: 'Ready to Chat', color: 'bg-gray-500' },
    [SessionStatus.Connecting]: { text: 'Connecting...', color: 'bg-yellow-500 animate-pulse' },
    [SessionStatus.Listening]: { text: 'Listening...', color: 'bg-green-500 animate-pulse' },
    [SessionStatus.Error]: { text: 'Error', color: 'bg-red-500' },
  };

  return (
    <div className="flex items-center justify-center space-x-2">
      <div className={`w-3 h-3 rounded-full ${statusInfo[status].color}`}></div>
      <span className="text-gray-400 text-sm">{statusInfo[status].text}</span>
    </div>
  );
};

const TranscriptView: React.FC<{ transcript: TranscriptEntry[] }> = ({ transcript }) => {
    const endOfTranscriptRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endOfTranscriptRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [transcript]);

    return (
        <div className="flex-grow bg-gray-800/50 rounded-lg p-4 overflow-y-auto space-y-4">
            {transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                    <p className="text-gray-400">Your conversation will appear here.</p>
                </div>
            ) : (
                transcript.map((entry, index) => (
                    <div key={index} className={`flex ${entry.speaker === Speaker.User ? 'justify-end' : 'justify-start'}`}>
                        <div
                            className={`max-w-xs md:max-w-md lg:max-w-lg px-4 py-2 rounded-xl ${
                                entry.speaker === Speaker.User
                                    ? 'bg-blue-600 text-white rounded-br-none'
                                    : 'bg-gray-700 text-gray-200 rounded-bl-none'
                            } ${!entry.isFinal ? 'opacity-70' : ''}`}
                        >
                            <span className="font-bold text-sm block mb-1">{entry.speaker === Speaker.User ? 'You' : 'AI'}</span>
                            <p>{entry.text}</p>
                        </div>
                    </div>
                ))
            )}
            <div ref={endOfTranscriptRef} />
        </div>
    );
};


export default function App() {
  const { status, transcript, error, startSession, stopSession } = useGeminiLive();
  const [isSessionActive, setIsSessionActive] = useState(false);

  const handleToggleSession = () => {
    if (isSessionActive) {
      stopSession();
      setIsSessionActive(false);
    } else {
      startSession();
      setIsSessionActive(true);
    }
  };

  useEffect(() => {
    if (status === SessionStatus.Error || status === SessionStatus.Idle) {
      setIsSessionActive(false);
    }
  }, [status]);
  
  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-gray-900 text-gray-100 p-4 font-sans">
        <div className="w-full max-w-2xl h-full flex flex-col shadow-2xl bg-gray-800 rounded-2xl border border-gray-700">
            <header className="p-4 border-b border-gray-700 text-center">
                <h1 className="text-2xl font-bold text-white">Real-Time AI Voice Chat</h1>
                <p className="text-sm text-gray-400">Powered by Gemini Live API</p>
            </header>

            <main className="flex-grow p-4 flex flex-col gap-4 min-h-0">
                <TranscriptView transcript={transcript} />
                {error && <div className="text-center text-red-400 bg-red-900/50 p-2 rounded-md">{error}</div>}
            </main>
            
            <footer className="p-4 border-t border-gray-700 flex flex-col items-center justify-center gap-4">
                <StatusIndicator status={status} />
                <button
                    onClick={handleToggleSession}
                    disabled={status === SessionStatus.Connecting}
                    className="relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ease-in-out focus:outline-none focus:ring-4 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                    <div className={`absolute inset-0 rounded-full transition-colors ${isSessionActive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}></div>
                    <div className="absolute inset-0 bg-black/10 rounded-full transform group-hover:scale-105 transition-transform"></div>

                    <div className="relative z-10 text-white">
                        {status === SessionStatus.Connecting ? (
                            <LoadingSpinner className="w-10 h-10" />
                        ) : isSessionActive ? (
                            <StopIcon className="w-8 h-8"/>
                        ) : (
                            <MicrophoneIcon className="w-10 h-10"/>
                        )}
                    </div>
                </button>
            </footer>
        </div>
    </div>
  );
}
