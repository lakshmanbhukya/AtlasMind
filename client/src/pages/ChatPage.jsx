import React, { useState, useCallback } from 'react';
import { useChat } from '../hooks/useChat';
import { useVoice } from '../hooks/useVoice';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useSchema } from '../hooks/useSchema';
import ScopeWorkspaceSelector from '../components/ScopeWorkspaceSelector';
import ChatInterface from '../components/ChatInterface';
import VoiceInputBar from '../components/VoiceInputBar';
import { sendVoice } from '../services/api';

export default function ChatPage({ onPin }) {
    const { messages, sendMessage, addVoiceResult, isLoading: isChatLoading } = useChat();
    const { isRecording, startRecording, stopRecording } = useVoice();
    const { workspaces, createWorkspace, updateWorkspace, deleteWorkspace } = useWorkspaces();
    const { schema } = useSchema();

    const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
    const [scopeMode, setScopeMode] = useState('all');
    const [selectedCollections, setSelectedCollections] = useState([]);

    const handleSelectWorkspace = useCallback((id, collections) => {
        setActiveWorkspaceId(id);
        if (id) {
            setScopeMode('selected');
            setSelectedCollections(collections || []);
        } else {
            setScopeMode('all');
            setSelectedCollections([]);
        }
    }, []);

    const handleSetCollections = useCallback((cols) => {
        setSelectedCollections(cols);
    }, []);

    const handleRemoveCollection = useCallback((colName) => {
        setSelectedCollections((prev) => prev.filter((c) => c !== colName));
    }, []);

    const handleSend = useCallback(async (text) => {
        const scopeOptions = {};
        if (scopeMode === 'selected' && selectedCollections?.length > 0) {
            scopeOptions.collections = selectedCollections;
        }
        if (activeWorkspaceId) {
            scopeOptions.workspaceId = activeWorkspaceId;
        }
        await sendMessage(text, scopeOptions);
    }, [sendMessage, scopeMode, selectedCollections, activeWorkspaceId]);

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
            <div className="flex-shrink-0 pt-2 px-4 z-20">
                <ScopeWorkspaceSelector
                    workspaces={workspaces}
                    activeWorkspaceId={activeWorkspaceId}
                    onSelectWorkspace={handleSelectWorkspace}
                    scopeMode={scopeMode}
                    onChangeScopeMode={setScopeMode}
                    selectedCollections={selectedCollections}
                    onSetCollections={handleSetCollections}
                    onRemoveCollection={handleRemoveCollection}
                    schema={schema}
                    onCreateWorkspace={createWorkspace}
                    onUpdateWorkspace={updateWorkspace}
                    onDeleteWorkspace={deleteWorkspace}
                />
            </div>

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
