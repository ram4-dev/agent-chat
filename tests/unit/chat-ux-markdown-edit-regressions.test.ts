import { createRequire } from 'node:module';
import { MessageMarkdown } from '../../apps/web/src/features/chat/MessageMarkdown';
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


const require = createRequire(new URL('../../apps/web/package.json', import.meta.url));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Window } = require('happy-dom');
const gfmShapes = [
  'Hola  \n@Analista revisá esto',
  'Hola\\\n@Analista revisá esto',
  '| Bot |\n| --- |\n|@Analista|',
  'Bot|Otro\n---|---\n@Analista|texto',
  '| A | B |\n| - | - |\n|texto|@Analista|',
  '|@Analista|Bot|\n|---|---|\n|x|y|',
  '|Bot|\n|---|\n|**@Analista**|',
  '|Bot|\n|---|\n|[@Analista](https://example.com/@destination)|',
  '![@Analista](https://example.com/@destination "@title")',
  '![**@Analista**](https://example.com/@destination)',
  '![# @Analista](https://example.com/@destination)',
  '![  @Analista](https://example.com/@destination)',
  '![`@Analista`](https://example.com/@destination)',
  '![@Analista][bot]\n\n[bot]: https://example.com/@destination',
  '![Etiqueta [sitio](https://example.com/@hidden) @Analista](https://example.com/image)',
  '![a `]` @Analista](https://example.com/image)',
  '[![@Analista](https://example.com/@image)](https://example.com/@link)',
];
describe('GFM renderer and mention guard parity', () => {
  it.each(gfmShapes)('guards visible mentions and maps their exact source offsets: %s', text => {
    const window = new Window();
    try {
      window.document.body.innerHTML = renderToStaticMarkup(createElement(MessageMarkdown, { text }));
      expect(window.document.body.textContent).toContain('@Analista');
      expect(unresolvedMentions(text, [])).toEqual([text.indexOf('@Analista')]);
    } finally { window.happyDOM.abort(); }
  });
  it.each(gfmShapes)('preserves the explicitly chosen ID when wrapping its unique surviving token: %s', text => {
    const selected = reconcileMentions('@Analista', text, [first]);
    expect(selected).toEqual([{ ...first, start: text.indexOf('@Analista'), end: text.indexOf('@Analista') + 9 }]);
    expect(unresolvedMentions(text, selected)).toEqual([]);
  });
  it('excludes table code, GFM email autolinks, reference destinations and image URL/title text', () => {
    const text = '| Bot |\n| --- |\n|`@Code`|\n|ana@example.com|\n\n![bot](https://example.com/@url "@title")\n\n![bot][image]\n\n[image]: https://example.com/@reference';
    expect(mentionStarts(text)).toEqual([]);
  });
  it('keeps multiple rendered image-alt mentions unresolved, including code flattened into alt text', () => {
    const text = '![@Analista `@Otro`](https://example.com/@hidden)';
    expect(unresolvedMentions(text, [])).toEqual([text.indexOf('@Analista'), text.indexOf('@Otro')]);
    expect(unresolvedMentions(text, [{ ...first, start: 2, end: 11 }])).toEqual([text.indexOf('@Otro')]);
  });
  it('guards literal HTML text that the safe renderer prints visibly', () => {
    expect(unresolvedMentions('<span>@Analista</span>', [])).toEqual([6]);
    expect(mentionStarts('<img src="https://example.com/@destination">')).toEqual([]);
  });
  it('conservatively blocks image labels whose block-looking source has no unique inline mapping', () => {
    for (const text of ['![[ref]: @Analista](https://example.com)']) {
      const window = new Window();
      try {
        window.document.body.innerHTML = renderToStaticMarkup(createElement(MessageMarkdown, { text }));
        expect(window.document.body.textContent).toContain('@Analista');
        expect(unresolvedMentions(text, [])).not.toEqual([]);
        expect(reconcileMentions('@Analista', text, [first])).toEqual([]);
      } finally { window.happyDOM.abort(); }
    }
  });
});
