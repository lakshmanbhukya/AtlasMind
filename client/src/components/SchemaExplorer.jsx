import React, { useState } from 'react';
import { Database, ChevronRight, Table, Key, Type, Search, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Helper function to highlight search matches
 */
const highlightMatch = (text, searchTerm) => {
    if (!searchTerm) return text;
    
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
        regex.test(part) ? (
            <span key={index} className="bg-[#ff6b35] text-[#0a0e14] px-0.5 rounded-sm">
                {part}
            </span>
        ) : (
            part
        )
    );
};

/**
 * Upgraded Schema Explorer (Inline)
 * Merges the visual fidelity of SchemaExplorerPanel with the inline utility of the original.
 */
export default function SchemaExplorer({ schema, isLoading, onRefresh }) {
    // Manage expansion internally for UI responsiveness
    const [expandedNodes, setExpandedNodes] = useState({});
    const [searchTerm, setSearchTerm] = useState('');

    const toggleNode = (nodeName) => {
        setExpandedNodes(prev => ({
            ...prev,
            [nodeName]: !prev[nodeName]
        }));
    };

    const filterSchema = (collections) => {
        if (!searchTerm) return collections;
        return collections.filter(coll =>
            coll.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            coll.fields.some(f => f.name.toLowerCase().includes(searchTerm.toLowerCase()))
        );
    };

    if (isLoading) {
        return (
            <div className="p-4 text-[#94a3b8] text-xs font-sans flex items-center gap-2">
                <RefreshCw size={14} className="animate-spin" />
                Loading schema...
            </div>
        );
    }

    if (!schema) {
        return (
            <div className="p-4 text-[#94a3b8] text-xs font-sans">
                No schema loaded
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-transparent">
            {/* Header - 64px height, sharp 2px bottom border */}
            <div className="h-16 px-4 flex items-center justify-between border-b-2 border-[#2d3748]">
                <div className="flex items-center gap-2">
                    <Database size={20} className="text-[#ff6b35] flex-shrink-0" />
                    <span className="font-display text-sm font-bold text-[#e2e8f0] uppercase tracking-[0.1em]">
                        Schema
                    </span>
                </div>
                <button 
                    onClick={onRefresh} 
                    className="p-1.5 hover:bg-[#1a2332] transition-all duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)] rounded-sm"
                >
                    <RefreshCw size={14} className="text-[#94a3b8]" />
                </button>
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-[#2d3748]">
                <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#64748b]" size={14} />
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full bg-[#151b24] border-2 border-[#2d3748] rounded-sm py-1.5 pl-8 pr-2 text-xs text-[#e2e8f0] font-sans focus:outline-none focus:border-[#06b6d4] focus:shadow-[0_0_0_2px_#06b6d4] transition-all duration-[200ms]"
                    />
                </div>
            </div>

            {/* Section Header - Space Grotesk Bold 10px uppercase */}
            <div className="px-4 pt-3 pb-2">
                <span className="font-display text-[10px] font-bold text-[#475569] uppercase tracking-[0.1em]">
                    Collections
                </span>
            </div>

            {/* List - Condensed spacing (4px gaps) */}
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {filterSchema(schema.collections || []).map((collection) => (
                    <div key={collection.name} className="mb-1">
                        {/* Collection button - DM Sans Medium 13px */}
                        <button
                            onClick={() => toggleNode(collection.name)}
                            className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#1a2332] transition-all duration-[150ms] ease-[cubic-bezier(0.4,0,0.2,1)] rounded-sm relative group"
                        >
                            {/* 4px left accent bar when active - slides in from left with 250ms ease-out */}
                            <motion.div
                                initial={false}
                                animate={{
                                    scaleX: expandedNodes[collection.name] ? 1 : 0,
                                    opacity: expandedNodes[collection.name] ? 1 : 0
                                }}
                                transition={{
                                    duration: 0.25,
                                    ease: [0.4, 0, 0.2, 1]
                                }}
                                className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-[60%] bg-[#ff6b35] rounded-r-sm origin-left"
                            />
                            
                            <div className="flex items-center gap-2 overflow-hidden">
                                {/* Chevron rotates 90deg with 200ms cubic-bezier */}
                                <motion.div
                                    animate={{ rotate: expandedNodes[collection.name] ? 90 : 0 }}
                                    transition={{
                                        duration: 0.2,
                                        ease: [0.4, 0, 0.2, 1]
                                    }}
                                >
                                    <ChevronRight size={14} className="text-[#94a3b8] flex-shrink-0" />
                                </motion.div>
                                <Table size={14} className="text-[#06b6d4] flex-shrink-0" />
                                <span className="text-[13px] font-sans font-medium text-[#e2e8f0] truncate">
                                    {highlightMatch(collection.name, searchTerm)}
                                </span>
                            </div>
                            {collection.documentCount !== undefined && (
                                <span className="text-[9px] font-mono text-[#64748b] bg-[#0a0e14] px-1.5 py-0.5 rounded-sm flex-shrink-0 ml-2">
                                    {collection.documentCount >= 1000
                                        ? `${(collection.documentCount / 1000).toFixed(1)}k`
                                        : collection.documentCount}
                                </span>
                            )}
                        </button>

                        {/* Fields - 24px indentation, DM Sans Regular 11px */}
                        <AnimatePresence>
                            {expandedNodes[collection.name] && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                                    className="overflow-hidden"
                                >
                                    <div className="ml-6 pl-0 space-y-0.5 mt-1">
                                        {collection.fields.map((field) => (
                                            <div 
                                                key={field.name} 
                                                className="flex items-center justify-between py-1.5 px-3 hover:bg-[#1a2332] transition-all duration-[150ms] rounded-sm group/field"
                                            >
                                                <div className="flex items-center gap-2 overflow-hidden">
                                                    <Key size={10} className="text-[#64748b] flex-shrink-0" />
                                                    <span className="text-[11px] font-sans text-[#94a3b8] truncate">
                                                        {highlightMatch(field.name, searchTerm)}
                                                    </span>
                                                </div>
                                                {/* Type badge - IBM Plex Mono 9px uppercase, sharp corners */}
                                                <span className="text-[9px] font-mono text-[#0a0e14] bg-[#06b6d4] px-1.5 py-0.5 rounded-sm flex-shrink-0 ml-2 uppercase font-normal">
                                                    {field.type}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                ))}

                {schema.collections && filterSchema(schema.collections).length === 0 && (
                    <div className="text-center py-4 text-xs font-sans text-[#64748b]">
                        No matches found
                    </div>
                )}
            </div>
        </div>
    );
}
