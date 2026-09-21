// A small RFC 4180 CSV reader for the Data view's import. It is strict where
// leniency would silently corrupt data (an unterminated quote throws) and
// lenient where files vary in the wild (BOM, CRLF/LF/CR, comma/semicolon/tab/
// pipe delimiters, blank lines).

const DELIMITERS = [",", ";", "\t", "|"] as const;

export class CsvError extends Error {}

export interface ParsedCsv {
  rows: string[][];
  delimiter: string;
}

// Picks the delimiter that appears most in the first line outside quotes;
// comma wins ties and files with none at all (a single-column file).
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMITERS.map((d) => [d, 0]));
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best = ",";
  for (const d of DELIMITERS) if (counts.get(d)! > counts.get(best)!) best = d;
  return best;
}

export function parseCsv(input: string, delimiter?: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Distinguishes an empty *quoted* field ("") from no field at all when a
  // line ends, so a line holding just "" still counts as a one-cell row.
  let sawQuote = false;

  const endField = () => {
    row.push(field);
    field = "";
    sawQuote = false;
  };
  const endRow = () => {
    const quoted = sawQuote;
    endField();
    // A blank line parses as a single empty cell; skip those rather than
    // importing an empty row.
    if (!(row.length === 1 && row[0] === "" && !quoted)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      sawQuote = true;
    } else if (ch === sep) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new CsvError("The file has a quoted value that never closes. Check for a stray quote character.");
  // Flush a final line that has no trailing newline.
  if (field !== "" || row.length > 0 || sawQuote) endRow();
  return { rows, delimiter: sep };
}
