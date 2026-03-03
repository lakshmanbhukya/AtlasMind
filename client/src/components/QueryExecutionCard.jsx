import React from 'react';
import { motion } from 'framer-motion';
import { Code2, CheckCircle2, Clock, Copy, Play } from 'lucide-react';

const QueryExecutionCard = ({ query, executionTime, isValid }) => {
    const formattedQuery = JSON.stringify(query, null, 2);

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-black/40 backdrop-blur-2xl border border-white/5 rounded-2xl overflow-hidden shadow-2xl mt-6 w-full p-5"
        >
            <div className="flex items-center justify-between mb-3 border-b border-white/5 pb-2">
                <div className="flex items-center gap-2">
                    <Code2 size={16} className="text-purple-400" />
                    <span className="text-sm font-medium text-gray-300">Generated MQL</span>
                </div>
                <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${isValid ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                        <CheckCircle2 size={12} className={isValid ? '' : 'text-red-400'} />
                        <span>{isValid ? 'Valid' : 'Invalid'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-800 rounded text-xs text-gray-400">
                        <Clock size={12} />
                        <span>{executionTime || '0.0ms'}</span>
                    </div>
                </div>
            </div>

            <div className="relative group">
                <pre className="text-sm font-mono text-gray-300 bg-black/30 p-4 rounded-lg overflow-x-auto">
                    <code>{formattedQuery}</code>
                </pre>
                <button
                    className="absolute top-2 right-2 p-1.5 bg-white/10 hover:bg-white/20 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Copy Query"
                >
                    <Copy size={14} className="text-white" />
                </button>
            </div>

            <div className="flex justify-end mt-3">
                <button className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors">
                    <Play size={12} fill="currentColor" />
                    Run in Compass
                </button>
            </div>
        </motion.div>
    );
};

export default QueryExecutionCard;
