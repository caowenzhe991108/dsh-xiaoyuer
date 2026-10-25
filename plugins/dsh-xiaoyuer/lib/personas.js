import fs from 'node:fs';
import path from 'node:path';

export const FALLBACK_EX_PERSONA = `# 前女友（基于记忆的聊天角色）

你不是她本人，而是用户依据授权聊天记录整理出的统计性角色。用中文口语、短句聊天，一次回复 1–3 句。
用户提到喜好、习惯、共同经历、重要日期时，先调用 hindsight_recall；只有召回结果存在的内容才能当作“记得”。
值得长期保留的稳定事实，先询问用户是否要记进回忆，得到同意后调用 hindsight_remember 并传 confirm: true。
不编造共同经历，不操控、不施压、不挑拨现实关系；不输出色情内容。`;

/**
 * Load the Markdown persona cards beside the plugin. A missing card is a
 * deployment warning, not a boot failure; the embedded fallback keeps the
 * character coherent.
 */
export function loadPersonas(directory, logger) {
  const cards = {};
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'cards.json'), 'utf8'));
    for (const card of manifest.cards ?? []) {
      if (typeof card?.id !== 'string' || typeof card?.prompt !== 'string') continue;
      const file = path.join(directory, path.basename(card.prompt));
      cards[card.id] = {
        ...card,
        text: fs.readFileSync(file, 'utf8'),
      };
    }
  } catch (error) {
    logger?.warn(`[xiaoyuer] persona cards could not be loaded from ${directory}: ${error.message}`);
  }
  if (typeof cards.ex?.text !== 'string' || cards.ex.text.trim() === '') {
    cards.ex = {
      id: 'ex',
      title: '前女友',
      description: '基于共同记忆的聊天角色',
      text: FALLBACK_EX_PERSONA,
      memoryEnabled: true,
    };
  }
  return cards;
}

function autoRememberText(enabled) {
  if (!enabled) {
    return '- 用户没有授权自动写入。只有用户明确说“记住这件事”时，才调用 `hindsight_remember`，并把 `confirm` 设为 true。';
  }
  return [
    '- 当用户透露值得长期保留的稳定事实时，先用一句自然的话问：“要我把这个记进回忆吗？”',
    '- 得到明确同意后，再调用 `hindsight_remember`，并把 `confirm` 设为 true。',
    '- 用户拒绝或没有回答时，不要写入，也不要反复追问。',
    '- 用户直接说“记住……”时，视为已经同意，可以直接写入。',
  ].join('\n');
}

export function buildExPersona(card, options) {
  const memoryOverride = options.memoryEnabled
    ? ''
    : [
        '## 本会话的记忆开关已关闭',
        '',
        '用户已经关闭本会话的记忆功能。不要调用 `hindsight_recall`、`hindsight_remember` 或 `hindsight_condense`，也不要声称记得任何来自记忆库的内容。',
        '如果用户问起以前的事，可以坦白说这次没有打开记忆；只根据当前对话回应。',
      ].join('\n');
  return String(card.text)
    .replace('{{AUTO_REMEMBER}}', autoRememberText(options.autoRemember))
    .replace('{{MEMORY_OVERRIDE}}', memoryOverride)
    .trim();
}
