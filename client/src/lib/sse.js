/**
 * Incremental Server-Sent Events parser (the parts of the format the API uses):
 * `event:` and `data:` fields, multi-line data, `:` comments (pings), and
 * LF / CRLF / CR line endings, with chunks split anywhere.
 *
 * Pure (no DOM, no `import.meta.env`), so node unit tests can import it.
 *
 * @param {(event: { event: string, data: string }) => void} onEvent
 * @returns {{ push: (chunk: string) => void, end: () => void }}
 */
export function createSseParser(onEvent) {
    let buffer = '';
    let eventName = '';
    let dataLines = [];

    const dispatch = () => {
        if (dataLines.length > 0) onEvent({ event: eventName || 'message', data: dataLines.join('\n') });
        eventName = '';
        dataLines = [];
    };

    const line = (text) => {
        if (text === '') return dispatch();
        if (text.startsWith(':')) return undefined; // comment / keep-alive ping
        const colon = text.indexOf(':');
        const field = colon === -1 ? text : text.slice(0, colon);
        let value = colon === -1 ? '' : text.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') eventName = value;
        else if (field === 'data') dataLines.push(value);
        return undefined;
    };

    return {
        push(chunk) {
            buffer += chunk;
            // A trailing '\r' may be the first half of '\r\n': keep it until the next chunk.
            const re = /\r\n|\n|\r(?!$)/g;
            let start = 0;
            let match;
            while ((match = re.exec(buffer)) !== null) {
                line(buffer.slice(start, match.index));
                start = match.index + match[0].length;
            }
            buffer = buffer.slice(start);
        },
        end() {
            if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
            if (buffer) line(buffer);
            buffer = '';
            dispatch();
        },
    };
}
