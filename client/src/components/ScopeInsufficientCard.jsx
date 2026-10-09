import { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, Plus, ArrowRight, Loader2, Database } from 'lucide-react';
import { Button } from './ui/button';
import { ShimmerButton } from './ui/shimmer-button';
import { Badge } from './ui/badge';

/**
 * ScopeInsufficientCard — inline card rendered when a query requires
 * collections outside the active scope. Reuses ClarificationCard styling.
 *
 * Props:
 *   naturalLanguage      {string}   - The user query
 *   suggestedCollections {string[]} - Collections needed
 *   currentScope         {string[]} - Active collections
 *   onAddAndRerun        {Function} - async (collectionsToAdd) => void
 *   onRunAll             {Function} - async () => void
 *   isLoading            {boolean}
 */
export default function ScopeInsufficientCard({
    naturalLanguage,
    suggestedCollections = [],
    currentScope = [],
    onAddAndRerun,
    onRunAll,
    isLoading = false,
}) {
    const [selectedToAdd, setSelectedToAdd] = useState(() => [...suggestedCollections]);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const toggleCollection = (col) => {
        setSelectedToAdd((prev) =>
            prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
        );
    };

    const handleAddAndRerun = async () => {
        if (selectedToAdd.length === 0 || isSubmitting || isLoading) return;
        setIsSubmitting(true);
        try {
            await onAddAndRerun(selectedToAdd);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="atlas-glass rounded-[20px] rounded-tl-[4px] p-5 max-w-2xl w-full border border-amber-500/20 shadow-sm bg-[#0d131f]/80"
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                <ShieldAlert className="h-4 w-4 text-amber-400" />
                <span className="text-[12px] font-bold uppercase tracking-widest text-amber-400/90">
                    Scope Expansion Required
                </span>
            </div>

            {/* Original query */}
            <p className="text-sm text-foreground/80 mb-3">
                You asked:{' '}
                <span className="font-semibold text-foreground">"{naturalLanguage}"</span>
            </p>

            <p className="text-[13px] text-muted-foreground/80 mb-4 leading-relaxed">
                This query requires data from collection{suggestedCollections.length > 1 ? 's' : ''} not currently in your active scope.
                Select collections to add to your scope and re-run:
            </p>

            {/* Collection checklist pills */}
            <div className="flex flex-wrap gap-2 mb-5">
                {suggestedCollections.map((col) => {
                    const isChecked = selectedToAdd.includes(col);
                    return (
                        <button
                            key={col}
                            type="button"
                            onClick={() => toggleCollection(col)}
                            disabled={isSubmitting || isLoading}
                            className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 ${
                                isChecked
                                    ? 'bg-primary/20 border-primary/40 text-primary shadow-[0_0_12px_rgba(0,237,100,0.15)]'
                                    : 'bg-white/[0.04] border-white/10 text-muted-foreground hover:bg-white/[0.08]'
                            }`}
                        >
                            <span
                                className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors ${
                                    isChecked ? 'border-primary bg-primary text-black' : 'border-white/30'
                                }`}
                            >
                                {isChecked && <span className="text-[10px] font-bold">✓</span>}
                            </span>
                            <Database className="h-3 w-3 opacity-60" />
                            <span>{col}</span>
                            <Badge variant="outline" className="text-[9px] py-0 px-1 border-white/10 text-muted-foreground/70">
                                Required
                            </Badge>
                        </button>
                    );
                })}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3 pt-2 border-t border-white/5">
                <ShimmerButton
                    onClick={handleAddAndRerun}
                    disabled={selectedToAdd.length === 0 || isSubmitting || isLoading}
                    shimmerColor="#00ed64"
                    background="#042f1a"
                    borderRadius="12px"
                    className="px-5 py-2 text-[13px] font-bold h-9 flex items-center gap-2"
                >
                    {isSubmitting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Plus className="h-3.5 w-3.5" />
                    )}
                    Add & Re-run Query
                </ShimmerButton>

                {onRunAll && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={onRunAll}
                        disabled={isSubmitting || isLoading}
                        className="text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 h-9 rounded-xl px-4"
                    >
                        Run on All collections
                    </Button>
                )}
            </div>
        </motion.div>
    );
}
