import { useState, useCallback, useRef } from 'react';

/**
 * Voice recording hook using MediaRecorder API.
 * Returns recording state and controls.
 */
export function useVoice() {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState(null);
    const mediaRecorderRef = useRef(null);
    const chunksRef = useRef([]);

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
        } catch (err) {
            setError('Microphone access denied. Please allow microphone permissions.');
            console.error('[Voice] Failed to start recording:', err);
        }
    }, []);

    const stopRecording = useCallback(() => {
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
    }, []);

    const cancelRecording = useCallback(() => {
        const mediaRecorder = mediaRecorderRef.current;

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            mediaRecorder.stop();
        }

        chunksRef.current = [];
        setIsRecording(false);
    }, []);

    return {
        isRecording,
        error,
        startRecording,
        stopRecording,
        cancelRecording,
    };
}
