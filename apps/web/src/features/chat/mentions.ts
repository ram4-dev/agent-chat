import { fromMarkdown } from 'mdast-util-from-markdown';

export interface Mention {
  id: string;
  name: string;
  start: number;
  end: number;
}
export interface MentionEdit { start: number; end: number }
interface Intent { start: number; visibleText: string }

/** Walk rendered text, including formatting and link labels, without URL destinations/code. */
function mentionIntents(text: string): Intent[] {
  let visible = '';
  const positions: Array<{ source: number; rendered: number }> = [];
  type MarkdownNode = { type: string; value?: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[] };
  function walk(node: MarkdownNode) {
    if (['code', 'inlineCode', 'html', 'image', 'imageReference'].includes(node.type)) {
      visible += '\ufffc';
      return;
    }
    if (node.type === 'text' && node.position) {
      const offset = node.position.start.offset ?? 0;
      const raw = text.slice(offset, node.position.end.offset);
      const value = node.value ?? raw;
      let renderedAt = -1;
      for (const match of raw.matchAll(/@|&#0*64;|&#x0*40;|&commat;/giu)) {
        renderedAt = value.indexOf('@', renderedAt + 1);
        if (renderedAt === -1) break;
        let slashes = 0;
        for (let at = match.index - 1; at >= 0 && raw[at] === '\\'; at--) slashes++;
        if (slashes % 2 === 0) positions.push({ source: offset + match.index, rendered: visible.length + renderedAt });
      }
      visible += value;
      return;
    }
    const block = ['root', 'paragraph', 'heading', 'listItem', 'blockquote'].includes(node.type);
    if (block) visible += '\n';
    node.children?.forEach(walk);
    if (block) visible += '\n';
  }
  walk(fromMarkdown(text));
  return positions.filter(position => /(?:^|[\s([{>"'])(?:\*{1,2}|_{1,2}|~~)*$/u.test(visible.slice(0, position.rendered)))
    .map(position => ({ start: position.source, visibleText: visible.slice(position.rendered) }));
}
function matchesMention(text: string, intent: Intent, mention: Mention): boolean {
  const label = `@${mention.name}`;
  const after = intent.visibleText[label.length];
  return intent.start === mention.start && mention.end === mention.start + label.length &&
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
