import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, Loader2 } from 'lucide-react';

const VoiceInputBar = ({ onSend, isProcessing, isRecording, onToggleRecording }) => {
    const [text, setText] = useState('');
    const [volume, setVolume] = useState(0);
    const [isFocused, setIsFocused] = useState(false);

    // Simulate voice volume fluctuation when recording
    useEffect(() => {
        let interval;
        if (isRecording) {
            interval = setInterval(() => {
                setVolume(Math.random() * 0.5 + 0.5); // Random volume between 0.5 and 1.0
            }, 100);
        } else {
            setVolume(0);
        }
        return () => clearInterval(interval);
    }, [isRecording]);

    const handleToggle = () => {
        onToggleRecording();
        if (isRecording) {
            // Stop recording
        } else {
            // Start recording
            setText('');
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (text.trim()) {
            onSend(text);
            setText('');
        }
    };

    return (
        <div className="w-full max-w-3xl mx-auto p-4 md:pb-8 z-50">
            <motion.form
                onSubmit={handleSubmit}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="relative group"
            >
                <div 
                    className="relative flex items-center overflow-hidden transition-all duration-200"
                    style={{
                        background: '#151b24',
                        border: '2px solid #2d3748',
                        borderRadius: '2px',
                        boxShadow: 'none'
                    }}
                >

                    {/* Recording State Overlay */}
                    <AnimatePresence>
                        {isRecording && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="absolute inset-0 bg-red-500/10 z-10 flex items-center justify-center pointer-events-none"
                            >
                                <div className="flex items-center gap-1 h-full">
                                    {[...Array(20)].map((_, i) => (
                                        <motion.div
                                            key={i}
                                            className="w-1 bg-red-500 mx-[1px]"
                                            style={{ borderRadius: '0' }}
                                            animate={{
                                                height: [4, 4 + (Math.sin(i * 0.5) * 12 + 12) * volume, 4],
                                                opacity: 0.7
                                            }}
                                            transition={{
                                                duration: 0.5,
                                                repeat: Infinity,
                                                delay: i * 0.05
                                            }}
                                        />
                                    ))}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {/* Text Input */}
                    <input
                        type="text"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onFocus={() => setIsFocused(true)}
                        onBlur={() => setIsFocused(false)}
                        placeholder={isRecording ? "Listening..." : "Ask anything about your data..."}
                        className={`w-full py-4 pl-6 pr-32 bg-transparent focus:outline-none transition-opacity duration-200 ${isRecording ? 'opacity-0' : 'opacity-100'}`}
                        style={{
                            color: '#e2e8f0',
                            fontFamily: 'DM Sans, sans-serif',
                            fontSize: '15px'
                        }}
                        disabled={isRecording || isProcessing}
                    />

                    {/* Action Buttons Container */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 flex items-center gap-2">
                        {/* Voice Button */}
                        {!text && (
                            <motion.button
                                type="button"
                                onClick={handleToggle}
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className={`p-3 flex items-center justify-center transition-all ${
                                    isRecording 
                                        ? 'voice-btn-recording' 
                                        : 'voice-btn-default'
                                }`}
                                style={{
                                    border: isRecording ? '2px solid #ef4444' : '2px solid #2d3748',
                                    background: 'transparent',
                                    color: isRecording ? '#ef4444' : '#94a3b8',
                                    borderRadius: '2px',
                                    width: '40px',
                                    height: '40px'
                                }}
                                disabled={isProcessing && !isRecording}
                            >
                                {isRecording ? (
                                    <Square size={20} fill="currentColor" />
                                ) : (
                                    <Mic size={20} />
                                )}
                            </motion.button>
                        )}

                        {/* Send Button */}
                        {text && (
                            <motion.button
                                type="submit"
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                className="send-btn-brutalist flex items-center justify-center transition-all"
                                style={{
                                    background: '#ff6b35',
                                    color: '#0a0e14',
                                    border: 'none',
                                    borderRadius: '2px',
                                    width: '40px',
                                    height: '40px',
                                    fontWeight: '700'
                                }}
                                disabled={isProcessing}
                            >
                                {isProcessing ? (
                                    <Loader2 size={20} className="animate-spin" />
                                ) : (
                                    <motion.span 
                                        initial={{ scale: 0 }} 
                                        animate={{ scale: 1 }}
                                        style={{ fontSize: '20px', lineHeight: '1' }}
                                    >
                                        →
                                    </motion.span>
                                )}
                            </motion.button>
                        )}
                    </div>
                </div>

                {/* Helper Text */}
                <AnimatePresence>
                    {isRecording && (
                        <motion.p
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -5 }}
                            className="absolute -top-8 left-0 w-full text-center text-xs font-medium tracking-wide uppercase"
                            style={{
                                color: '#ef4444',
                                fontFamily: 'DM Sans, sans-serif'
                            }}
                        >
                            Recording... Tap to stop
                        </motion.p>
                    )}
                </AnimatePresence>
            </motion.form>
        </div>
    );
};

export default VoiceInputBar;
