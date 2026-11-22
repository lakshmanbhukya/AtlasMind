import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Longest recording, in seconds. The AtlasMind allowance reserves 60 s of voice per
 * question, so a recording stops here and is sent as if the user pressed Send.
 */
export const MAX_RECORDING_SECONDS = 60;

/**
 * Voice recording hook using MediaRecorder API.
 * Returns recording state and controls.
 *
 * `onLimit(blob)` gets the recording when it reaches MAX_RECORDING_SECONDS
 * (the caller sends it). A Send or Cancel before then clears the limit timer.
 */
export function useVoice({ onLimit } = {}) {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);
    const limitTimerRef = useRef(null);
    const onLimitRef = useRef(onLimit);
    useEffect(() => {
        onLimitRef.current = onLimit;
    }, [onLimit]);

    const clearLimitTimer = useCallback(() => {
        clearTimeout(limitTimerRef.current);
        limitTimerRef.current = null;
    }, []);

    // Unmounting mid-recording must not fire onLimit later.
    useEffect(() => clearLimitTimer, [clearLimitTimer]);

    const stopRecording = useCallback(() => {
        clearLimitTimer();
        return new Promise((resolve) => {
            const mediaRecorder = mediaRecorderRef.current;

            if (!mediaRecorder || mediaRecorder.state === 'inactive') {
                resolve(null);
                return;
            }

            mediaRecorder.onstop = () => {
                const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                chunksRef.current = [];
                setIsRecording(false);

                // Stop all tracks to release microphone
                mediaRecorder.stream.getTracks().forEach((track) => track.stop());

                resolve(blob);
            };

            mediaRecorder.stop();
        });
    }, [clearLimitTimer]);

    const startRecording = useCallback(async () => {
        setError(null);
        chunksRef.current = [];

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            const mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm',
            });

            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current = mediaRecorder;
            mediaRecorder.start();
            setIsRecording(true);

            clearLimitTimer();
            limitTimerRef.current = setTimeout(() => {
                limitTimerRef.current = null;
                stopRecording().then((blob) => {
                    if (blob) onLimitRef.current?.(blob);
                });
            }, MAX_RECORDING_SECONDS * 1000);
        } catch (err) {
            setError('Microphone access denied. Please allow microphone permissions.');
            console.error('[Voice] Failed to start recording:', err);
        }
    }, [clearLimitTimer, stopRecording]);

    const cancelRecording = useCallback(() => {
        clearLimitTimer();
        const mediaRecorder = mediaRecorderRef.current;

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            mediaRecorder.stop();
        }

        chunksRef.current = [];
        setIsRecording(false);
    }, [clearLimitTimer]);

    return {
        isRecording,
        error,
        startRecording,
        stopRecording,
        cancelRecording,
    };
}
