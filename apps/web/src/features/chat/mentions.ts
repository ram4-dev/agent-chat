import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';

// Keep the syntax pipeline identical to MessageMarkdown's default parser + remarkGfm.
const parser = unified().use(remarkParse).use(remarkGfm);

export interface Mention {
  id: string;
  name: string;
  start: number;
  end: number;
}
export interface MentionEdit { start: number; end: number }
interface Intent { start: number; visibleText: string; unmapped?: boolean }

/** Walk rendered text, including formatting and link labels, without URL destinations/code. */
function mentionIntents(text: string): Intent[] {
  let visible = '';
  const positions: Array<{ source: number; rendered: number; unmapped?: boolean }> = [];
  type MarkdownNode = { type: string; value?: string; alt?: string | null; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[] };
  const tree = parser.parse(text);
  const definitions = tree.children.filter(node => node.type === 'definition')
    .map(node => text.slice(node.position?.start.offset, node.position?.end.offset)).join('\n');
  function append(raw: string, value: string, offset: number) {
    let renderedAt = -1;
    for (const match of raw.matchAll(/@|&#0*64;|&#x0*40;|&commat;/giu)) {
      renderedAt = value.indexOf('@', renderedAt + 1);
      if (renderedAt === -1) break;
      let slashes = 0;
      for (let at = match.index - 1; at >= 0 && raw[at] === '\\'; at--) slashes++;
      if (slashes % 2 === 0) positions.push({ source: offset + match.index, rendered: visible.length + renderedAt });
    }
    visible += value;
  }
  // Image nodes flatten their label into alt. Recover the label with the same parser,
  // preserving source offsets while excluding nested link/image destinations and titles.
  function imageLabelEnd(source: string, start: number, end: number): number {
    let brackets = 1;
    for (let at = start; at < end; at++) {
      if (source[at] === '\\') { at++; continue; }
      if (source[at] === '`') {
        const run = /^`+/u.exec(source.slice(at))![0];
        const ticks = /`+/gu; ticks.lastIndex = at + run.length;
        let closing: RegExpExecArray | null;
        while ((closing = ticks.exec(source)) && closing[0].length !== run.length) { /* Find the matching code delimiter. */ }
        if (closing && closing.index < end) { at = closing.index + run.length - 1; continue; }
        at += run.length - 1; continue;
      }
      if (source[at] === '[') brackets++;
      if (source[at] !== ']') continue;
      if (--brackets === 0) return at;
      if (source[at + 1] === '(') {
        let parentheses = 1, quote = '', angle = false;
        for (at += 2; at < end && parentheses; at++) {
          const char = source[at]!;
          if (char === '\\') { at++; continue; }
          if (quote) { if (char === quote) quote = ''; continue; }
          if (angle) { if (char === '>') angle = false; continue; }
          if (char === '<') angle = true;
          else if ((char === '"' || char === "'") && /\s/u.test(source[at - 1]!)) quote = char;
          else if (char === '(') parentheses++;
          else if (char === ')') parentheses--;
        }
        at--;
      }
    }
    return end;
  }
  function walk(node: MarkdownNode, base = 0, alt = false) {
    if (node.type === 'definition') return;
    if (node.type === 'break') { visible += '\n'; return; }
    const offset = base + (node.position?.start.offset ?? 0);
    const end = base + (node.position?.end.offset ?? 0);
    if ((node.type === 'image' || node.type === 'imageReference') && node.position) {
      const start = offset + 2; // ![
      const label = text.slice(start, imageLabelEnd(text, start, end));
      const labelTree = parser.parse(label + '\n\n' + definitions);
      const visibleStart = visible.length, positionStart = positions.length;
      walk(labelTree, start, true);
      const renderedAlt = node.alt ?? '';
      const projectedAlt = visible.slice(visibleStart);
      if (projectedAlt !== renderedAlt) {
        const projectedAts = [...projectedAlt.matchAll(/@/gu)].map(match => match.index);
        const renderedAts = [...renderedAlt.matchAll(/@/gu)].map(match => match.index);
        if (projectedAts.length === renderedAts.length) {
          // Block-looking alt syntax may normalize whitespace. Preserve only its
          // known source mapping; the renderer's actual alt remains authoritative.
          for (const position of positions.slice(positionStart)) {
            position.rendered = visibleStart + renderedAts[projectedAts.indexOf(position.rendered - visibleStart)]!;
          }
        } else {
          // Ambiguous source mapping must never attach a previously selected ID.
          positions.length = positionStart;
          for (const at of renderedAts) positions.push({ source: offset, rendered: visibleStart + at, unmapped: true });
        }
        visible = visible.slice(0, visibleStart) + renderedAlt;
      }
      return;
    }
    if (['code', 'inlineCode'].includes(node.type) && !alt) {
      visible += '\ufffc';
      return;
    }
    if (node.position && (['text', 'html'].includes(node.type) || (alt && ['code', 'inlineCode'].includes(node.type)))) {
      const raw = text.slice(offset, end);
      append(raw, node.value ?? raw, offset);
      return;
    }
    const block = ['root', 'paragraph', 'heading', 'listItem', 'blockquote', 'table', 'tableRow', 'tableCell'].includes(node.type) && !alt;
    if (block) visible += '\n';
    node.children?.forEach(child => walk(child, base, alt));
    if (block) visible += '\n';
  }
  walk(tree);
  return positions.filter(position => /(?:^|[\s([{>"'])(?:\*{1,2}|_{1,2}|~~)*$/u.test(visible.slice(0, position.rendered)))
    .map(position => ({ start: position.source, visibleText: visible.slice(position.rendered), ...(position.unmapped ? { unmapped: true } : {}) }));
}
function matchesMention(text: string, intent: Intent, mention: Mention): boolean {
  const label = `@${mention.name}`;
  const after = intent.visibleText[label.length];
  return !intent.unmapped && intent.start === mention.start && mention.end === mention.start + label.length &&
    text.slice(mention.start, mention.end) === label && intent.visibleText.startsWith(label) &&
    (!after || /[\s.,!?;:)\]}]/u.test(after) || /^(?:\*{1,2}|_{1,2}|~~)(?:$|[\s.,!?;:)\]}])/u.test(intent.visibleText.slice(label.length)));
}

/** Retain IDs only for surviving tokens; an exact browser edit range disambiguates duplicates. */
export function reconcileMentions(before: string, after: string, mentions: readonly Mention[], edit?: MentionEdit): Mention[] {
  const delta = after.length - before.length;
  const inserted = edit ? delta + edit.end - edit.start : -1;
  const exactEdit = edit && edit.start >= 0 && edit.end >= edit.start && edit.end <= before.length && inserted >= 0 &&
    before.slice(0, edit.start) === after.slice(0, edit.start) &&
    before.slice(edit.end) === after.slice(edit.start + inserted) ? edit : undefined;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const oldIntents = mentionIntents(before), nextIntents = mentionIntents(after);
  return mentions.flatMap(mention => {
    const occurrences = (text: string, intents: Intent[]) => intents.filter(intent => matchesMention(text, intent, { ...mention, start: intent.start, end: intent.start + mention.end - mention.start }));
    const oldTokens = occurrences(before, oldIntents), nextTokens = occurrences(after, nextIntents);
    // Without a trustworthy range, deleting one of identical labels has no unique identity mapping.
    if (!exactEdit && oldTokens.length > 1 && oldTokens.length !== nextTokens.length) return [];
    let start = exactEdit
      ? mention.end <= exactEdit.start ? mention.start : mention.start >= exactEdit.end ? mention.start + delta : -1
      : mention.end <= prefix ? mention.start : mention.start >= before.length - suffix ? mention.start + delta : -1;
    if (start < 0 && mentions.filter(item => item.name === mention.name).length === 1 && oldTokens.length === 1 && nextTokens.length === 1) start = nextTokens[0]!.start;
    const next = { ...mention, start, end: start + mention.end - mention.start };
    return start >= 0 && nextIntents.some(intent => matchesMention(after, intent, next)) ? [next] : [];
  });
}

export function mentionStarts(text: string): number[] {
  return mentionIntents(text).map(intent => intent.start);
}
export function unresolvedMentions(text: string, mentions: readonly Mention[]): number[] {
  return mentionIntents(text).filter(intent => !mentions.some(mention => matchesMention(text, intent, mention))).map(intent => intent.start);
}
export function mentionQuery(text: string, position: number, mentions: readonly Mention[]) {
  const start = unresolvedMentions(text, mentions).filter(at => at < position).at(-1);
  if (start === undefined) return undefined;
  const query = text.slice(start + 1, position);
  return query.length <= 60 && !query.includes('\n') && !query.includes('@')
    ? { start, end: position, text: query }
    : undefined;
}
