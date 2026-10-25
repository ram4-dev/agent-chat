import { describe, expect, it } from 'vitest';
import { mentionStarts, reconcileMentions, unresolvedMentions, type Mention } from '../../apps/web/src/features/chat/mentions';
const first: Mention = { id: 'first-id', name: 'Analista', start: 0, end: 9 };
const second: Mention = { ...first, id: 'second-id', start: 10, end: 19 };

describe('rendered Markdown mention intent', () => {
  it.each(['**@Analista** revisá esto', '*@Analista*', '_@Analista_', '~~@Analista~~', '[@Analista](https://example.com)', '[**@Analista**](https://example.com/@destination)'])('blocks unresolved formatted text: %s', text => {
    expect(unresolvedMentions(text, [])).toEqual([text.indexOf('@Analista')]);
  });
  it('excludes destinations, reference definitions, code, escaped @ and formatted email addresses', () => {
    const text = '[sitio](https://example.com/@destination)\n\n[otro][ref]\n\n[ref]: https://example.com/@reference\n\n`@inline`\n\n```\n@code\n```\n\n\\@literal ana**@example**.com';
    expect(mentionStarts(text)).toEqual([]);
  });
  it('keeps exact selected IDs when inserting strong markers or a link around an intact token', () => {
    const opened = reconcileMentions('@Analista', '**@Analista', [first], { start: 0, end: 0 });
    const formatted = reconcileMentions('**@Analista', '**@Analista**', opened, { start: 11, end: 11 });
    expect(formatted).toEqual([{ ...first, start: 2, end: 11 }]);
    expect(unresolvedMentions('**@Analista**', formatted)).toEqual([]);
    expect(reconcileMentions('@Analista ', '@Analista revisá esto', [first], { start: 0, end: 10 })).toEqual([first]);
    const linked = reconcileMentions('@Analista', '[@Analista](https://example.com)', [first]);
    expect(linked).toEqual([{ ...first, start: 1, end: 10 }]);
    expect(unresolvedMentions('[@Analista](https://example.com)', linked)).toEqual([]);
  });
  it('invalidates edited labels and detects adjacent rendered word edits', () => {
    expect(reconcileMentions('@Analista', '@Otro', [first], { start: 0, end: 9 })).toEqual([]);
    const text = '@Analista**Other**';
    expect(reconcileMentions('@Analista', text, [first])).toEqual([]);
    expect(unresolvedMentions(text, [first])).toEqual([0]);
  });
});

describe('identical labels retain only the surviving browser-selected identity', () => {
  const before = '@Analista @Analista ';
  it('deleting the first token and its following space retains the second ID', () => {
    expect(reconcileMentions(before, '@Analista ', [first, second], { start: 0, end: 10 })).toEqual([{ ...second, start: 0, end: 9 }]);
  });
  it('deleting the second token and its following space retains the first ID', () => {
    expect(reconcileMentions(before, '@Analista ', [first, second], { start: 10, end: 20 })).toEqual([first]);
  });
  it('invalidates ambiguous identical deletions when the browser supplies no trustworthy edit range', () => {
    expect(reconcileMentions(before, '@Analista ', [first, second])).toEqual([]);
    expect(unresolvedMentions('@Analista ', [])).toEqual([0]);
    expect(reconcileMentions(before, '@Analista ', [first, second], { start: 3, end: 4 })).toEqual([]);
  });
});
