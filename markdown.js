/**
 * Simple Markdown Parser for OmniAgent
 * Supports: **bold**, *italic*, `code`, [links], - lists, and Tables
 */
function parseMarkdown(text) {
    if (!text) return "";

    // Escape HTML (basic)
    let safeText = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Pre-processing: Code blocks to placeholders to avoid messing with pipes/stars inside code
    const codeBlocks = [];
    safeText = safeText.replace(/```([\s\S]*?)```/g, (match, code) => {
        codeBlocks.push(`<pre><code>${code}</code></pre>`);
        return `__CODEBLOCK_${codeBlocks.length - 1}__`;
    });

    safeText = safeText.replace(/`([^`]+)`/g, (match, code) => {
        return `<code>${code}</code>`;
    });

    // Formatting
    safeText = safeText
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    const lines = safeText.split('\n');
    let output = "";

    let inList = false;
    let inTable = false;
    let tableHeaders = [];
    let tableAlignments = [];

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // --- List Handling ---
        if (line.startsWith('- ')) {
            if (inTable) { output += "</tbody></table>"; inTable = false; }
            if (!inList) { output += "<ul>"; inList = true; }
            output += `<li>${line.substring(2)}</li>`;
            continue;
        } else if (inList) {
            output += "</ul>";
            inList = false;
        }

        // --- Table Handling ---
        // Basic check: line starts and ends with | or contains | surrounded by spaces
        // Valid header: | A | B |
        // Valid sep: |---|---|
        if (line.includes('|')) {
            const isSeparator = line.match(/^\|?\s*:?-+:?\s*(\| :?-+:?\s*)+\|?$/); // |---|---|

            if (!inTable) {
                // Potential Header? Look ahead for separator
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    if (nextLine.match(/^\|?\s*:?-+:?\s*(\| :?-+:?\s*)+\|?$/)) {
                        inTable = true;
                        output += "<table class='md-table'><thead><tr>";
                        const headers = line.split('|').filter(c => c.trim() !== ''); // Basic split
                        headers.forEach(h => output += `<th>${h.trim()}</th>`);
                        output += "</tr></thead><tbody>";
                        i++; // Skip separator line
                        continue;
                    }
                }
            } else {
                // We are in table, this is a row
                if (isSeparator) {
                    // Ignore extra separators
                    continue;
                }

                output += "<tr>";
                const cells = line.split('|');
                // Filter edge empty strings if the row starts/ends with pipe
                const cleanCells = cells.filter((c, idx) => {
                    if ((idx === 0 || idx === cells.length - 1) && c.trim() === '') return false;
                    return true;
                });

                // If cleanCells is empty but line had |, it might be malformed, but try to render
                if (cleanCells.length === 0 && line.length > 1) {
                    output += `<td>${line}</td>`;
                } else {
                    cleanCells.forEach(c => output += `<td>${c.trim()}</td>`);
                }
                output += "</tr>";
                continue;
            }
        }

        if (inTable) {
            output += "</tbody></table>";
            inTable = false;
        }

        // Normal Line
        if (line.length > 0) {
            output += line + "<br>";
        }
    }

    if (inList) output += "</ul>";
    if (inTable) output += "</tbody></table>";

    // Restore Code Blocks
    output = output.replace(/__CODEBLOCK_(\d+)__/g, (match, id) => codeBlocks[id]);

    return output;
}
