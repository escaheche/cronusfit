import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sanitizeInput } from '../../src/validation/sanitize.js';

/**
 * Property 10: Input sanitization strips HTML and encodes specials
 *
 * For any input string containing HTML tags, the sanitization function SHALL
 * produce an output containing zero HTML tags. For any input string, the output
 * SHALL have all special characters (<, >, &, ", ') encoded as their HTML entity equivalents.
 *
 * **Validates: Requirements 5.9**
 */
describe('Property 10: Input sanitization strips HTML and encodes specials', () => {
  const HTML_TAG_REGEX = /<[^>]*>/;

  it('output never contains HTML tags for arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeInput(input);
        expect(output).not.toMatch(HTML_TAG_REGEX);
      }),
      { numRuns: 200 }
    );
  });

  it('output never contains HTML tags for strings with injected HTML tags', () => {
    const htmlTag = fc.constantFrom(
      '<b>',
      '</b>',
      '<script>',
      '</script>',
      '</div>',
      '<div>',
      '<img src="x">',
      '<a href="#">',
      '<!-- comment -->',
      '<br/>',
      '<input type="text">'
    );

    const inputWithTags = fc
      .tuple(fc.string(), htmlTag, fc.string(), htmlTag, fc.string())
      .map(([pre, tag1, mid, tag2, post]) => `${pre}${tag1}${mid}${tag2}${post}`);

    fc.assert(
      fc.property(inputWithTags, (input) => {
        const output = sanitizeInput(input);
        expect(output).not.toMatch(HTML_TAG_REGEX);
      }),
      { numRuns: 200 }
    );
  });

  it('output never contains raw < or > characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeInput(input);
        // After sanitization, no raw < or > should exist
        // They should only appear as &lt; or &gt;
        expect(output).not.toMatch(/(?<!&[a-z]+)[<>]/);
        // More precise: check no literal < or > exists at all
        expect(output.indexOf('<')).toBe(-1);
        expect(output.indexOf('>')).toBe(-1);
      }),
      { numRuns: 200 }
    );
  });

  it('output never contains raw double quote characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeInput(input);
        expect(output.indexOf('"')).toBe(-1);
      }),
      { numRuns: 200 }
    );
  });

  it('output never contains raw single quote characters', () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeInput(input);
        expect(output.indexOf("'")).toBe(-1);
      }),
      { numRuns: 200 }
    );
  });

  it('output never contains raw & that is not part of a valid entity', () => {
    // After sanitization, every & should be the start of a known entity:
    // &amp; &lt; &gt; &quot; &#x27;
    const VALID_ENTITY_REGEX = /&(amp|lt|gt|quot|#x27);/g;

    fc.assert(
      fc.property(fc.string(), (input) => {
        const output = sanitizeInput(input);
        // Remove all valid entities, then check no & remains
        const withoutEntities = output.replace(VALID_ENTITY_REGEX, '');
        expect(withoutEntities.indexOf('&')).toBe(-1);
      }),
      { numRuns: 200 }
    );
  });

  it('for inputs with <script> tags, output is free of any tags', () => {
    const scriptInput = fc
      .tuple(fc.string(), fc.string(), fc.string())
      .map(([pre, content, post]) => `${pre}<script>${content}</script>${post}`);

    fc.assert(
      fc.property(scriptInput, (input) => {
        const output = sanitizeInput(input);
        expect(output).not.toMatch(HTML_TAG_REGEX);
        expect(output.indexOf('<')).toBe(-1);
        expect(output.indexOf('>')).toBe(-1);
      }),
      { numRuns: 200 }
    );
  });
});
