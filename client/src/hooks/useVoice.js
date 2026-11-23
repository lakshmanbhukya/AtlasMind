import { useState, useCallback, useEffect, useRef } from 'react';

export const MAX_RECORDING_SECONDS = 60;

function stopTracks(stream) {
    stream?.getTracks().forEach((track) => track.stop());
}

/** A manual Send or the time limit keeps the audio. Cancel and unmount discard it. */
export function useVoice({ onLimit } = {}) {
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState(null);
    const active = useRef(null);
    const onLimitRef = useRef(onLimit);
    useEffect(() => {
        onLimitRef.current = onLimit;
    }, [onLimit]);

    const discard = useCallback(() => {
        const session = active.current;
        if (!session) return;
        active.current = null;
        clearTimeout(session.timer);
        const recorder = session.recorder;
        if (recorder) {
            recorder.onstop = null;
            recorder.ondataavailable = null;
            if (recorder.state !== 'inactive') recorder.stop();
        }
        stopTracks(session.stream);
        // Navigation can happen between a Send click and the recorder's stop event.
        session.resolve?.(null);
    }, []);

    useEffect(() => discard, [discard]);

    const stopRecording = useCallback(() => {
        const session = active.current;
        if (session?.recorder?.state !== 'recording') return Promise.resolve(null);
        clearTimeout(session.timer);
        return new Promise((resolve) => {
            session.resolve = resolve;
            session.recorder.stop();
        });
    }, []);

    const startRecording = useCallback(async () => {
        if (active.current) return;
        const session = { stream: null, recorder: null, timer: null, resolve: null };
        active.current = session;
        setError(null);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (active.current !== session) {
                stopTracks(stream);
                return;
            }
            session.stream = stream;
            const recorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus'
                    : 'audio/webm',
            });
            session.recorder = recorder;
            const chunks = [];
            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) chunks.push(event.data);
            };
            recorder.onstop = () => {
                active.current = null;
                clearTimeout(session.timer);
                stopTracks(stream);
                setIsRecording(false);
                session.resolve?.(new Blob(chunks, { type: 'audio/webm' }));
            };
            recorder.start();
            setIsRecording(true);
            session.timer = setTimeout(async () => {
                const blob = await stopRecording();
                if (blob) onLimitRef.current?.(blob);
            }, MAX_RECORDING_SECONDS * 1000);
        } catch (err) {
            if (active.current !== session) return;
            discard();
            setError(err?.name === 'NotAllowedError'
                ? 'Microphone access denied. Please allow microphone permissions.'
                : 'Could not start the microphone. Check your recording device and try again.');
        }
    }, [discard, stopRecording]);

    const cancelRecording = useCallback(() => {
        discard();
        setIsRecording(false);
    }, [discard]);

    return { isRecording, error, startRecording, stopRecording, cancelRecording };
}
