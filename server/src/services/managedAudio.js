// @ts-check
'use strict';

const { execFile } = require('node:child_process');
const { mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { QueryEngineError, ValidationError } = require('./engineErrors');

const run = promisify(execFile);
const MAX_SECONDS = 60;
const BYTES_PER_SECOND = 16000 * 2;

/**
 * Measure the audio we actually send to Whisper. MediaRecorder WebM can omit
 * duration metadata, and container headers alone cannot establish a billable length.
 * @param {Buffer} input
 */
async function prepareManagedAudio(input) {
    const dir = await mkdtemp(join(tmpdir(), 'atlasmind-voice-'));
    const source = join(dir, 'input');
    const output = join(dir, 'recording.wav');
    try {
        await writeFile(source, input, { mode: 0o600 });
        try {
            await run('ffmpeg', [
                '-nostdin', '-v', 'error', '-xerror',
                '-format_whitelist', 'matroska,webm,mov,mp3,wav,ogg,flac',
                '-protocol_whitelist', 'file', '-threads', '1', '-i', source,
                '-map', '0:a:0', '-map_metadata', '-1', '-af', 'asetpts=N/SR/TB',
                '-t', String(MAX_SECONDS + 1), '-ac', '1', '-ar', '16000',
                '-c:a', 'pcm_s16le', '-bitexact', '-f', 'wav', output,
            ], { timeout: 15000, killSignal: 'SIGKILL', windowsHide: true });
        } catch (err) {
            if (typeof err.code !== 'number' && !err.killed) {
                throw new QueryEngineError('Audio processing is unavailable.', 'audio_processing_unavailable', 503);
            }
            throw new ValidationError('Could not read the audio recording.', 'upload_error');
        }
        // FFmpeg's bitexact mono PCM writer emits a 44-byte RIFF header.
        const wav = await readFile(output);
        if (wav.length <= 44 || wav.toString('ascii', 36, 40) !== 'data'
            || wav.readUInt32LE(40) !== wav.length - 44) {
            throw new ValidationError('Could not read the audio recording.', 'upload_error');
        }
        const seconds = (wav.length - 44) / BYTES_PER_SECOND;
        if (seconds > MAX_SECONDS) {
            throw new ValidationError('Recordings over 60 seconds need your own Groq key.', 'upload_error');
        }
        return { wav, seconds };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

module.exports = { prepareManagedAudio };
