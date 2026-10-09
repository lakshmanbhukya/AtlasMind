import { useState } from 'react';
import { motion } from 'framer-motion';
import { HelpCircle, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from './ui/button';
import { ShimmerButton } from './ui/shimmer-button';
import { cn } from '../lib/utils';

/**
 * ClarificationCard — inline chat card that prompts the user to resolve query
 * ambiguity before execution. Rendered by AtlasChatPanel when the backend
 * returns `needsClarification: true`.
 *
 * Props:
 *   naturalLanguage  {string}   - The original query text shown as context
 *   questions        {Array}    - Array of clarification question objects
 *   onSubmit         {Function} - async (clarifications: [{id, value}]) => void
 *   onBypass         {Function} - () => void  — run with LLM assumptions
 *   isLoading        {boolean}  - parent-level loading gate (disables all controls)
 */
export default function ClarificationCard({
  naturalLanguage,
  questions = [],
  initialAnswers = [],
  onSubmit,
  onBypass,
  isLoading = false,
}) {
  // Initialize answers from initialAnswers (on edit) or pre-select recommended options
  const [answers, setAnswers] = useState(() => {
    const init = {};
    if (Array.isArray(initialAnswers) && initialAnswers.length > 0) {
      for (const ans of initialAnswers) {
        if (ans && ans.id && ans.value) {
          init[ans.id] = ans.value;
        }
      }
    }
    for (const q of questions) {
      if (init[q.id] !== undefined) continue;
      const rec = (q.options || []).find((o) => o.recommended);
      if (rec) {
        init[q.id] = q.type === 'multiple' || q.type === 'multi' ? [rec.value] : rec.value;
      }
    }
    return init;
  });
  // Map of questionId → custom text when "__other__" is selected
  const [customTexts, setCustomTexts] = useState(() => {
    const initCustom = {};
    if (Array.isArray(initialAnswers)) {
      for (const ans of initialAnswers) {
        if (ans && ans.id && ans.customText) {
          initCustom[ans.id] = ans.customText;
        }
      }
    }
    return initCustom;
  });
  // Local submitting state for the Continue button
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /** Select (or deselect for multi) an option for a given question */
  const handleSelect = (questionId, value, type) => {
    const isMulti = type === 'multiple' || type === 'multi';
    if (isMulti) {
      setAnswers((prev) => {
        const current = Array.isArray(prev[questionId]) ? prev[questionId] : [];
        const exists = current.includes(value);
        return {
          ...prev,
          [questionId]: exists
            ? current.filter((v) => v !== value)
            : [...current, value],
        };
      });
    } else {
      // Single-choice: set selected radio option
      setAnswers((prev) => ({
        ...prev,
        [questionId]: value,
      }));
    }
  };

  /** Update the free-text for __other__ on a specific question */
  const handleCustomText = (questionId, text) => {
    setCustomTexts((prev) => ({ ...prev, [questionId]: text }));
  };

  /**
   * A question is "answered" when:
   *  - single: answers[id] is defined (and if __other__, customText is non-empty)
   *  - multi:  answers[id] is a non-empty array
   */
  const isAnswered = (question) => {
    const val = answers[question.id];
    const isMulti = question.type === 'multiple' || question.type === 'multi';
    if (isMulti) {
      return Array.isArray(val) && val.length > 0;
    }
    if (!val) return false;
    if (val === '__other__') return (customTexts[question.id] || '').trim().length > 0;
    return true;
  };

  const canContinue = questions.length > 0 && questions.every(isAnswered);

  const handleContinue = async () => {
    if (!canContinue || isSubmitting || isLoading) return;
    setIsSubmitting(true);

    try {
      const clarifications = questions.flatMap((q) => {
        const val = answers[q.id];
        const isMulti = q.type === 'multiple' || q.type === 'multi';

        if (isMulti) {
          const values = Array.isArray(val) ? val : [val];
          return values
            .map((v) =>
              v === '__other__'
                ? { id: q.id, value: '__other__', customText: (customTexts[q.id] || '').trim() }
                : { id: q.id, value: v }
            )
            .filter((item) => item.value && (item.value !== '__other__' || item.customText));
        }

        // Single-choice
        if (val === '__other__') {
          return [{ id: q.id, value: '__other__', customText: (customTexts[q.id] || '').trim() }];
        }
        return val ? [{ id: q.id, value: val }] : [];
      });

      await onSubmit(clarifications);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="atlas-glass rounded-[20px] rounded-tl-[4px] p-5 max-w-2xl w-full border border-white/5 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <HelpCircle className="h-4 w-4 text-primary/70" />
        <span className="text-[12px] font-bold uppercase tracking-widest text-muted-foreground/60">
          Clarification Needed
        </span>
      </div>

      {/* Original query */}
      <p className="text-sm text-foreground/80 mb-4">
        You asked:{' '}
        <span className="font-semibold text-foreground">"{naturalLanguage}"</span>
      </p>

      {/* Questions */}
      <div className="flex flex-col gap-5">
        {questions.map((question) => (
          <QuestionBlock
            key={question.id}
            question={question}
            selectedValue={answers[question.id]}
            customText={customTexts[question.id] || ''}
            onSelect={(value) => handleSelect(question.id, value, question.type)}
            onCustomText={(text) => handleCustomText(question.id, text)}
            disabled={isSubmitting || isLoading}
          />
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-3 mt-5">
        <ShimmerButton
          onClick={handleContinue}
          disabled={!canContinue || isSubmitting || isLoading}
          shimmerColor="#00ed64"
          background="#042f1a"
          borderRadius="12px"
          className="px-5 py-2 text-[13px] font-bold h-9 flex items-center gap-2"
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRight className="h-3.5 w-3.5" />
          )}
          Continue
        </ShimmerButton>

        <Button
          size="sm"
          variant="ghost"
          onClick={onBypass}
          disabled={isSubmitting || isLoading}
          className="text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 h-9 rounded-xl px-4"
        >
          Run anyway with assumptions
        </Button>
      </div>
    </motion.div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * QuestionBlock — renders a single clarification question with its options.
 */
function QuestionBlock({
  question,
  selectedValue,
  customText,
  onSelect,
  onCustomText,
  disabled,
}) {
  const isSingle = question.type !== 'multiple' && question.type !== 'multi';

  return (
    <div>
      {/* Question label */}
      <p className="text-[13px] font-semibold text-foreground/90 mb-2.5">
        {question.question}
      </p>

      {/* Options */}
      <div className="flex flex-col gap-2">
        {question.options?.map((option) => {
          const isSelected = isSingle
            ? selectedValue === option.value
            : Array.isArray(selectedValue) && selectedValue.includes(option.value);

          return (
            <div key={option.value}>
              {/* Option pill button */}
              <button
                onClick={() => !disabled && onSelect(option.value)}
                disabled={disabled}
                className={cn(
                  'flex items-center gap-3 w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed',
                  isSelected
                    ? 'bg-primary/15 border-primary/40 text-primary'
                    : 'bg-white/[0.03] border-white/[0.07] text-foreground/80 hover:bg-white/[0.06] hover:border-white/15'
                )}
              >
                {/* Radio / checkbox indicator */}
                {isSingle ? (
                  /* Radio-style indicator */
                  <span
                    className={cn(
                      'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                      isSelected ? 'border-primary bg-primary/30' : 'border-white/20'
                    )}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-primary" />
                    )}
                  </span>
                ) : (
                  /* Checkbox-style indicator */
                  <span
                    className={cn(
                      'w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors',
                      isSelected ? 'border-primary bg-primary/30' : 'border-white/20'
                    )}
                  >
                    {isSelected && (
                      <span className="w-2 h-2 bg-primary rounded-sm" />
                    )}
                  </span>
                )}

                <span className="text-[14px] font-medium">{option.label}</span>

                {/* Recommended badge */}
                {option.recommended && (
                  <span className="ml-auto text-[10px] text-primary/80 bg-primary/10 px-2 py-0.5 rounded font-semibold">
                    Recommended
                  </span>
                )}
              </button>

              {/* Free-text input for __other__ */}
              {option.value === '__other__' && isSelected && (
                <div className="mt-2 ml-7">
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => onCustomText(e.target.value)}
                    placeholder="Describe what you mean..."
                    disabled={disabled}
                    className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-4 py-2.5 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all duration-200 disabled:opacity-50"
                    autoFocus
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
