import { Mic, MicOff } from 'lucide-react';

/**
 * Voice recording toggle button.
 * Shows recording state with pulsing animation.
 */
export default function VoiceButton({ isRecording, onToggle, disabled }) {
    return (
        <button
            className={`chat-input-btn voice-btn ${isRecording ? 'recording' : ''}`}
            onClick={onToggle}
            disabled={disabled}
            title={isRecording ? 'Stop recording' : 'Start voice input'}
            aria-label={isRecording ? 'Stop voice recording' : 'Start voice recording'}
        >
            {isRecording ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
    );
}
