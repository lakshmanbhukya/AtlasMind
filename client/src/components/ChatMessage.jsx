import { useState, useCallback } from 'react';
import { Copy, Check, ShieldAlert, Clock, User, Bot } from 'lucide-react';
import ChartRenderer from './ChartRenderer';

/**
 * Renders a single chat message with optional MQL pipeline display,
 * chart visualization, and execution time badge.
 */
export default function ChatMessage({ message, onPin }) {
    const { role, content, pipeline, results, chartType, executionTimeMs, isError, safetyBlocked, safetyMessage } =
        message;

    const isUser = role === 'user';

    return (
        <div className={`message ${role}`}>
            <div className="message-avatar flex items-center justify-center bg-white/5 border border-white/10 rounded-full w-8 h-8 shrink-0">
                {isUser ? <User size={16} className="text-muted-foreground" /> : <Bot size={16} className="text-primary" />}
            </div>

            <div className="message-content">
                <div className="message-bubble">
                    {isError ? (
                        <span style={{ color: 'var(--error)' }}>{content}</span>
                    ) : isUser ? (
                        content
                    ) : (
                        <>
                            <p>Here are the results for: <strong>"{content}"</strong></p>

                            {safetyBlocked && (
                                <div className="safety-warning">
                                    <ShieldAlert size={16} />
                                    <span>{safetyMessage || 'This query was blocked by the safety guard. Only read operations are permitted.'}</span>
                                </div>
                            )}

                            {/* View Context - If available */}
                            {message.schemaContext && (
                                <MqlDisplay 
                                    pipeline={message.schemaContext} 
                                    label="View Schema Context" 
                                />
                            )}

                            {pipeline && !safetyBlocked && (
                                <MqlDisplay 
                                    pipeline={pipeline} 
                                    label="View Generated MQL" 
                                />
                            )}

                            {results && results.length > 0 && !safetyBlocked && (
                                <ChartRenderer
                                    data={results}
                                    chartType={chartType}
                                    query={content}
                                    onPin={onPin}
                                />
                            )}

                            {executionTimeMs != null && !safetyBlocked && (
                                <div className="exec-badge">
                                    <Clock size={12} />
                                    {executionTimeMs}ms
                                </div>
                            )}

                            {results && results.length === 0 && !safetyBlocked && (
                                <p style={{ color: 'var(--text-tertiary)', marginTop: 'var(--space-md)', fontStyle: 'italic' }}>
                                    No results found for this query.
                                </p>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * Displays the generated MQL pipeline with a copy button.
 */
function MqlDisplay({ pipeline, label = "Generated MQL Pipeline" }) {
    const [copied, setCopied] = useState(false);

    const pipelineStr = typeof pipeline === 'string' 
        ? pipeline 
        : JSON.stringify(pipeline, null, 2);

    const handleCopy = useCallback(() => {
        navigator.clipboard.writeText(pipelineStr);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [pipelineStr]);

    return (
        <div className="mql-display">
            <div className="mql-header">
                <span>{label}</span>
                <button className="mql-copy-btn" onClick={handleCopy}>
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? 'Copied!' : 'Copy'}
                </button>
            </div>
            <pre className="mql-code">{pipelineStr}</pre>
        </div>
    );
}
