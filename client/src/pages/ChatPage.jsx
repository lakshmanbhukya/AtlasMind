import React, { useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import ChatInterface from '../components/ChatInterface';
import VoiceInputBar from '../components/VoiceInputBar';
import { sendVoice } from '../services/api';

export default function ChatPage({ onPin }) {
    const { messages, sendMessage, addVoiceResult, isLoading: isChatLoading } = useChat();
    const { isRecording, startRecording, stopRecording } = useVoice();

    const handleSend = useCallback(async (text) => {
        await sendMessage(text);
    }, [sendMessage]);

    /**
     * Voice: stop recording → upload to POST /api/voice → get full pipeline result
     * (pipeline, results, chartType, confidenceScore, etc.) and feed to useChat.
     * addVoiceResult adds the transcript as a user message + AI result with all metadata.
     */
    const handleToggleRecording = useCallback(async () => {
        if (isRecording) {
            const blob = await stopRecording();
            if (!blob) return;

            const file = new File([blob], 'recording.webm', { type: blob.type });
            const formData = new FormData();
            formData.append('audio', file);

            try {
                const response = await sendVoice(blob);
                addVoiceResult(response); // adds transcript + full AI result with pipeline/results/chartType
            } catch (err) {
                console.error('Voice query failed:', err);
            }
        } else {
            startRecording();
        }
    }, [isRecording, startRecording, stopRecording, addVoiceResult]);

    return (
        <div className="chat-page relative h-full flex flex-col">
            <div className="flex-1 overflow-hidden relative">
                <ChatInterface
                    messages={messages}
                    isTyping={isChatLoading}
                    onSendMessage={handleSend}
                />
            </div>

            <div className="flex-shrink-0 bg-transparent relative z-10">
                <VoiceInputBar
                    onSend={handleSend}
                    isProcessing={isChatLoading}
                    isRecording={isRecording}
                    onToggleRecording={handleToggleRecording}
                />
            </div>
        </div>
    );
}
