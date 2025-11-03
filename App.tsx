import React, { useState, useEffect, useRef } from 'react';
import { useGeminiLive } from './hooks/useGeminiLive';
import { SessionStatus } from './types';
import { MicrophoneIcon, StopIcon, LoadingSpinner } from './components/Icons';
import { PasswordScreen } from './components/PasswordScreen';
import { VideoAvatar } from './components/VideoAvatar';

const ApiKeyPrompt: React.FC<{
  isStudioEnv: boolean;
  onSelectKey: () => void;
  onManualSubmit: (key: string) => void;
  error: string | null;
}> = ({ isStudioEnv, onSelectKey, onManualSubmit, error }) => {
  const [keyInput, setKeyInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onManualSubmit(keyInput);
  };

  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-gray-900 text-gray-100 p-4 font-sans">
      <div className="w-full max-w-md text-center bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-700">
        <h1 className="text-3xl font-bold text-white mb-4">Welcome!</h1>
        {isStudioEnv ? (
          <>
            <p className="text-gray-400 mb-6">
              To use this real-time voice chat, please select a Google AI API key. Your key is used only for this session and is not stored.
            </p>
            <button
              onClick={onSelectKey}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-300 focus:outline-none focus:ring-4 focus:ring-blue-500/50"
            >
              Select API Key
            </button>
          </>
        ) : (
          <>
            <p className="text-gray-400 mb-6">
              To use this real-time voice chat, please enter your Google AI API key below. Your key is used only for this session.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <input
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Enter your API Key"
                className="w-full bg-gray-700 text-white border border-gray-600 rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors duration-300 focus:outline-none focus:ring-4 focus:ring-blue-500/50"
              >
                Start Chat
              </button>
            </form>
          </>
        )}
        <p className="text-xs text-gray-500 mt-4">
          For more information on billing, please visit the{' '}
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
            Gemini API documentation
          </a>.
        </p>
        {error && (
          <div className="mt-4 text-center text-red-400 bg-red-900/50 p-3 rounded-md text-sm">
            <p className="font-semibold">Error</p>
            <p>{error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

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

export default function App() {
  // const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { status, error, startSession, stopSession, isSpeaking } = useGeminiLive();
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [apiKeyReady, setApiKeyReady] = useState(false);
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [isStudioEnv, setIsStudioEnv] = useState(false);
  const [envChecked, setEnvChecked] = useState(false);
  const [manualApiKey, setManualApiKey] = useState<string | undefined>();
  const autoStartedRef = useRef(false);
 
  useEffect(() => {
    const checkEnv = async () => {
      // The `window.aistudio` object is injected by the AI Studio environment.
      // We check for its existence to determine the execution context.
      const studio = (window as any).aistudio;
      if (studio) {
        setIsStudioEnv(true);
        if (await studio.hasSelectedApiKey()) {
          setApiKeyReady(true);
        }
      } else {
        // Not in AI studio, automatically use the provided key.
        setIsStudioEnv(false);
        setManualApiKey('AIzaSyCiYJLhhSRcsXBT4e-tixO9pvHCqptGtzo');
        setApiKeyReady(true);
      }
      setEnvChecked(true);
    };
    checkEnv();
  }, []);
  
  useEffect(() => {
    if (error && (error.includes('API key not valid') || error.includes('API key is invalid') || error.includes('Requested entity was not found'))) {
        setApiKeyReady(false);
        setApiKeyError(`${error}. Please select or enter a valid API key.`);
        setIsSessionActive(false);
        stopSession();
    }
  }, [error, stopSession]);

  // Auto-start the session once the API key is ready
  useEffect(() => {
    if (apiKeyReady && !isSessionActive && status === SessionStatus.Idle && !autoStartedRef.current) {
      autoStartedRef.current = true;
      startSession(manualApiKey);
      setIsSessionActive(true);
    }
  }, [apiKeyReady, isSessionActive, status, startSession, manualApiKey]);

  const handleSelectKey = async () => {
    try {
      await (window as any).aistudio.openSelectKey();
      // Assume success and optimistically set the key as ready.
      // The error handling effect will catch if the selected key is invalid.
      setApiKeyReady(true);
      setApiKeyError(null);
    } catch (e) {
      console.error("Error opening API key selection dialog", e);
      setApiKeyError("Could not open the API key dialog.");
    }
  };

  const handleManualKeySubmit = (key: string) => {
    const trimmedKey = key.trim();
    if (trimmedKey) {
        setManualApiKey(trimmedKey);
        setApiKeyReady(true);
        setApiKeyError(null);
    } else {
        setApiKeyError("Please enter a valid API key.");
    }
  };
  
  const handleToggleSession = () => {
    if (isSessionActive) {
      stopSession();
      setIsSessionActive(false);
    } else {
      startSession(manualApiKey);
      setIsSessionActive(true);
    }
  };

  useEffect(() => {
    if (status === SessionStatus.Error || status === SessionStatus.Idle) {
      const isApiKeyError = error && (error.includes('API key not valid') || error.includes('API key is invalid') || error.includes('Requested entity was not found'));
      if (!isApiKeyError) {
        setIsSessionActive(false);
      }
    }
  }, [status, error]);

  // if (!isAuthenticated) {
  //   return <PasswordScreen onSuccess={() => setIsAuthenticated(true)} />;
  // }

  if (!envChecked) {
      return (
        <div className="w-full h-screen flex items-center justify-center bg-gray-900 text-gray-100">
            <LoadingSpinner className="w-10 h-10" />
        </div>
      );
  }

  if (!apiKeyReady) {
    return (
        <ApiKeyPrompt
            isStudioEnv={isStudioEnv}
            onSelectKey={handleSelectKey}
            onManualSubmit={handleManualKeySubmit}
            error={apiKeyError}
        />
    );
  }
  
  return (
    <div className="w-full h-screen flex flex-col items-center justify-center bg-gray-900 text-gray-100 p-4 font-sans">
        <div className="w-full max-w-2xl h-full flex flex-col shadow-2xl bg-gray-800 rounded-2xl border border-gray-700">
            <header className="p-4 border-b border-gray-700 text-center">
                <h1 className="text-2xl font-bold text-white">Real-Time AI Voice Chat</h1>
                <p className="text-sm text-gray-400">Powered by Gemini Live API</p>
            </header>

            <main className="flex-grow p-4 flex flex-col gap-4 min-h-0">
                <VideoAvatar isSpeaking={isSpeaking} />
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