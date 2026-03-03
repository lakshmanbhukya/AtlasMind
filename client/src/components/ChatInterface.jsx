import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { User, Bot, Sparkles } from 'lucide-react';
import QueryExecutionCard from './QueryExecutionCard';
import InsightDashboard from './InsightDashboard';

const ChatInterface = ({ messages, isTyping, onSendMessage }) => {
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isTyping]);

    // Empty state when no messages
    const showEmptyState = messages.length === 0 && !isTyping;

    // Suggestion chips for empty state
    const suggestions = [
        "Show total sales by region",
        "Find top 10 customers",
        "Analyze monthly trends",
        "Count documents by status"
    ];

    const handleSuggestionClick = (suggestion) => {
        if (onSendMessage) {
            onSendMessage(suggestion);
        }
    };

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-transparent">
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
                {showEmptyState ? (
                    <div className="chat-welcome">
                        <div className="chat-welcome-icon">
                            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="10" y="20" width="60" height="40" stroke="currentColor" strokeWidth="3" fill="none" />
                                <line x1="10" y1="30" x2="70" y2="30" stroke="currentColor" strokeWidth="3" />
                                <rect x="20" y="38" width="15" height="3" fill="currentColor" />
                                <rect x="20" y="45" width="15" height="3" fill="currentColor" />
                                <rect x="20" y="52" width="15" height="3" fill="currentColor" />
                                <rect x="45" y="38" width="15" height="3" fill="currentColor" />
                                <rect x="45" y="45" width="15" height="3" fill="currentColor" />
                                <rect x="45" y="52" width="15" height="3" fill="currentColor" />
                            </svg>
                        </div>
                        <h2>Query Your Data</h2>
                        <p>Ask questions about your MongoDB collections in natural language. I'll help you explore, analyze, and visualize your data.</p>
                        
                        {/* Suggestion Chips */}
                        <div className="chat-suggestions">
                            {suggestions.map((suggestion, index) => (
                                <button
                                    key={index}
                                    className="chat-suggestion"
                                    onClick={() => handleSuggestionClick(suggestion)}
                                >
                                    {suggestion}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <AnimatePresence initial={false}>
                        {messages.map((msg, index) => (
                            <motion.div
                                key={msg.id || index}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                transition={{ duration: 0.3 }}
                                className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                <div className={`flex max-w-[90%] md:max-w-[85%] gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                                    {/* Avatar */}
                                    <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center shadow-lg border border-white/10 ${msg.role === 'user'
                                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                                        : 'bg-gradient-to-br from-emerald-500 to-teal-600'
                                        }`}>
                                        {msg.role === 'user' ? <User size={18} className="text-white" /> : <Bot size={18} className="text-white" />}
                                    </div>

                                    {/* Content Column */}
                                    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} w-full min-w-0`}>

                                        {/* Message Bubble */}
                                        {msg.content && (
                                            <div className={`px-6 py-6 shadow-lg border-l-2 ${msg.role === 'user'
                                                ? 'bg-[#151b24] text-[#e2e8f0] border-l-[#ff6b35]'
                                                : 'bg-[#151b24] text-[#e2e8f0] border-l-[#06b6d4]'
                                                }`}
                                                style={{
                                                    maxWidth: '720px',
                                                    borderRadius: '2px',
                                                    fontFamily: 'DM Sans, sans-serif',
                                                    fontSize: '15px',
                                                    lineHeight: '1.7'
                                                }}>
                                                {msg.content}
                                            </div>
                                        )}

                                        {/* Artifacts (Assistant Only) */}
                                        {msg.role !== 'user' && (
                                            <div className="w-full space-y-4 mt-3">
                                                {/* Generated MQL Pipeline */}
                                                {msg.pipeline && msg.pipeline.length > 0 && (
                                                    <QueryExecutionCard
                                                        query={msg.pipeline}
                                                        executionTime={msg.executionTimeMs}
                                                        isValid={!msg.safetyBlocked}
                                                    />
                                                )}

                                                {/* Chart Visualization */}
                                                {msg.results && msg.results.length > 0 && (
                                                    <InsightDashboard
                                                        data={msg.results}
                                                        type={msg.chartType || 'bar'}
                                                        title={msg.chartTitle}
                                                    />
                                                )}
                                            </div>
                                        )}

                                        <span className="text-xs text-gray-500 mt-2 px-1 opacity-70">
                                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}

                {/* Typing Indicator */}
                {isTyping && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="flex w-full justify-start"
                    >
                        <div className="flex max-w-[75%] gap-4">
                            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-600/20 flex items-center justify-center shadow-lg border border-emerald-500/20">
                                <Sparkles size={18} className="text-emerald-400 animate-pulse" />
                            </div>
                            <div className="px-5 py-4 bg-white/5 rounded-2xl rounded-tl-sm backdrop-blur-2xl border border-white/5 flex items-center gap-1.5 shadow-lg">
                                <motion.span
                                    className="w-2 h-2 bg-gray-400 rounded-full"
                                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0 }}
                                />
                                <motion.span
                                    className="w-2 h-2 bg-gray-400 rounded-full"
                                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }}
                                />
                                <motion.span
                                    className="w-2 h-2 bg-gray-400 rounded-full"
                                    animate={{ scale: [1, 1.2, 1], opacity: [0.5, 1, 0.5] }}
                                    transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }}
                                />
                            </div>
                        </div>
                    </motion.div>
                )}
                <div ref={messagesEndRef} className="h-4" />
            </div>
        </div>
    );
};

export default ChatInterface;
