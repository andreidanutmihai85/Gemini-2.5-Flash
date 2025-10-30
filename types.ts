
export enum Speaker {
  User = 'USER',
  AI = 'AI',
}

export interface TranscriptEntry {
  speaker: Speaker;
  text: string;
  isFinal: boolean;
}

export enum SessionStatus {
  Idle = 'IDLE',
  Connecting = 'CONNECTING',
  Listening = 'LISTENING',
  Error = 'ERROR',
}
