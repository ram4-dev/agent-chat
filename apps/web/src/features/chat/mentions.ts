import { fromMarkdown } from 'mdast-util-from-markdown';

export interface Mention {
  id: string;
  name: string;
  start: number;
  end: number;
}

/** Retain the selected identity only while its exact text survives an edit. */
export function reconcileMentions(before: string, after: string, mentions: readonly Mention[]): Mention[] {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const delta = after.length - before.length;
  return mentions.flatMap(mention => {
    let start = mention.end <= prefix ? mention.start : mention.start >= before.length - suffix ? mention.start + delta : -1;
    // A single surviving selected token may move when the surrounding text is replaced.
    // Its identity comes from the selection, never from an agent-name lookup.
    if (start < 0 && mentions.filter(item => item.name === mention.name).length === 1) {
      const label = `@${mention.name}`;
      const occurrences = (text: string) => mentionStarts(text).filter(at =>
        text.slice(at, at + label.length) === label &&
        (at + label.length === text.length || /[\s.,!?;:)\]}]/u.test(text[at + label.length]!)));
      const oldTokens = occurrences(before), nextTokens = occurrences(after);
      if (oldTokens.length === 1 && nextTokens.length === 1) start = nextTokens[0]!;
    }
    const end = start + mention.end - mention.start;
    if (start < 0 || after.slice(start, end) !== `@${mention.name}` ||
      (start > 0 && !/[\s([{>"']/u.test(after[start - 1]!)) ||
      (end < after.length && !/[\s.,!?;:)\]}]/u.test(after[end]!))) return [];
    return [{ ...mention, start, end }];
  });
}

/** Markdown code and escaped @ signs are literal text, as are addresses/URLs. */
export function mentionStarts(text: string): number[] {
  const ignored: Array<[number, number]> = [];
  const tree = fromMarkdown(text);
  type MarkdownNode = { type: string; position?: { start: { offset?: number }; end: { offset?: number } }; children?: MarkdownNode[] };
  function walk(node: MarkdownNode) {
    if (['code', 'inlineCode', 'link', 'image', 'html'].includes(node.type) && node.position) {
      ignored.push([node.position.start.offset ?? 0, node.position.end.offset ?? text.length]);
    } else node.children?.forEach(walk);
  }
  walk(tree);
  const starts: number[] = [];
  for (const match of text.matchAll(/(^|[\s([{>"'])@/gu)) {
    const start = match.index + match[1]!.length;
    if (!ignored.some(([from, to]) => start >= from && start < to)) starts.push(start);
  }
  return starts;
}

export function unresolvedMentions(text: string, mentions: readonly Mention[]): number[] {
  return mentionStarts(text).filter(start => !mentions.some(mention => mention.start === start));
}

export function mentionQuery(text: string, position: number, mentions: readonly Mention[]) {
  const start = unresolvedMentions(text, mentions).filter(at => at < position).at(-1);
  if (start === undefined) return undefined;
  const query = text.slice(start + 1, position);
  return query.length <= 60 && !query.includes('\n') && !query.includes('@')
    ? { start, end: position, text: query }
    : undefined;
}
