import { ProviderError } from '../../domain/index.js';

/**
 * Número JSON conservado como su TEXTO exacto (INV-001): el lector nunca lo convierte a `number`. La conversión a
 * decimal exacto la hace `canonicalRateValue` (domain) a partir de `text`.
 */
export class JsonNumber {
  constructor(readonly text: string) {
    Object.freeze(this);
  }
}

export type JsonValue = null | boolean | string | JsonNumber | JsonValue[] | { [key: string]: JsonValue };

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const MAX_DEPTH = 32;

const invalid = (message: string) => new ProviderError('PROVIDER_PAYLOAD_INVALID', message);

/**
 * `LosslessJsonReader` (design.md decisión 2): parser JSON (RFC 8259) que entrega los números como `JsonNumber` con
 * su texto exacto. Sustituye a `JSON.parse`/`response.json()`, prohibidos en `infrastructure/providers` (leerían
 * `12.020000000000000001` como `12.02`). Un cuerpo que no es JSON válido (p. ej. truncado) es
 * `PROVIDER_PAYLOAD_INVALID`.
 */
export const LosslessJsonReader = {
  read(text: string): JsonValue {
    const parser = new Parser(text);
    parser.ws();
    const value = parser.value(0);
    parser.ws();
    if (parser.pos !== text.length) throw invalid(`unexpected data at offset ${parser.pos}`);
    return value;
  },
};

class Parser {
  pos = 0;

  constructor(private readonly s: string) {}

  ws(): void {
    while (this.pos < this.s.length) {
      const c = this.s.charCodeAt(this.pos);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.pos++;
      else break;
    }
  }

  value(depth: number): JsonValue {
    if (depth > MAX_DEPTH) throw invalid('JSON nesting too deep');
    const c = this.s[this.pos];
    if (c === '{') return this.object(depth);
    if (c === '[') return this.array(depth);
    if (c === '"') return this.string();
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return this.number();
    if (this.s.startsWith('true', this.pos)) return this.literal('true', true);
    if (this.s.startsWith('false', this.pos)) return this.literal('false', false);
    if (this.s.startsWith('null', this.pos)) return this.literal('null', null);
    throw invalid(c === undefined ? 'unexpected end of JSON' : `unexpected character at offset ${this.pos}`);
  }

  private literal<T>(word: string, v: T): T {
    this.pos += word.length;
    return v;
  }

  private number(): JsonNumber {
    NUMBER.lastIndex = this.pos;
    const m = NUMBER.exec(this.s);
    if (!m) throw invalid(`invalid number at offset ${this.pos}`);
    this.pos += m[0].length;
    return new JsonNumber(m[0]);
  }

  private string(): string {
    this.pos++;
    let out = '';
    for (;;) {
      if (this.pos >= this.s.length) throw invalid('unterminated string');
      const c = this.s[this.pos++] as string;
      if (c === '"') return out;
      if (c === '\\') {
        const e = this.s[this.pos++];
        if (e === 'u') {
          const hex = this.s.slice(this.pos, this.pos + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw invalid('invalid unicode escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else {
          const map: Record<string, string> = {
            '"': '"',
            '\\': '\\',
            '/': '/',
            b: '\b',
            f: '\f',
            n: '\n',
            r: '\r',
            t: '\t',
          };
          const ch = e === undefined ? undefined : map[e];
          if (ch === undefined) throw invalid('invalid escape');
          out += ch;
        }
      } else if (c.charCodeAt(0) < 0x20) {
        throw invalid('control character in string');
      } else {
        out += c;
      }
    }
  }

  private array(depth: number): JsonValue[] {
    this.pos++;
    const out: JsonValue[] = [];
    this.ws();
    if (this.s[this.pos] === ']') {
      this.pos++;
      return out;
    }
    for (;;) {
      this.ws();
      out.push(this.value(depth + 1));
      this.ws();
      const c = this.s[this.pos++];
      if (c === ']') return out;
      if (c !== ',') throw invalid('expected , or ] in array');
    }
  }

  private object(depth: number): { [key: string]: JsonValue } {
    this.pos++;
    // Sin prototipo: una clave "__proto__" del tercero no contamina nada.
    const out = Object.create(null) as { [key: string]: JsonValue };
    this.ws();
    if (this.s[this.pos] === '}') {
      this.pos++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.s[this.pos] !== '"') throw invalid('expected string key in object');
      const key = this.string();
      this.ws();
      if (this.s[this.pos++] !== ':') throw invalid('expected : in object');
      this.ws();
      out[key] = this.value(depth + 1);
      this.ws();
      const c = this.s[this.pos++];
      if (c === '}') return out;
      if (c !== ',') throw invalid('expected , or } in object');
    }
  }
}

/** Objeto JSON (no arreglo ni primitivo). */
export const isJsonObject = (v: JsonValue | undefined): v is { [key: string]: JsonValue } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof JsonNumber);
