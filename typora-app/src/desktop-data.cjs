'use strict';

function mentions(value) {
  return [...String(value || '').matchAll(/@([\p{L}\p{N}_-]+)/gu)]
    .map(match => match[1]);
}

function taskBody(value, person) {
  const withoutName = String(value || '').replace(/@[\p{L}\p{N}_-]+/gu, '').replace(/\s+/g, ' ').trim();
  return withoutName;
}

function dateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function keywords(values, limit = 3) {
  const stop = new Set(['这里', '什么', '怎么', '如何', '为什么', '这个', '那个', '是否', '以及', '需要', '用户', '文档', '进行', '一个', '我们', '他们', '可以', '应该', '问题', '批注', '工作', '没有', '之后', '其中', '通过', '相关', '目前', '第二', '第一', '方案', '产品', '经理', '提示', '一下', '一般', '哪些', '多少', '还有', '对于', '内容', '方式', '情况', '时候', '里面', '一些', '关于', '解读', '请问', '看看', 'via', 'codex', 'deepseek', 'openai']);
  const counts = new Map();
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  for (const value of values) {
    for (const part of segmenter.segment(String(value || ''))) {
      const word = part.segment.trim().toLowerCase();
      if (!part.isWordLike || word.length < 2 || stop.has(word) || /^\d+$/.test(word) || /^@/.test(word)) continue;
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh'))
    .slice(0, limit).map(([word]) => word);
}

const PORTRAIT_MIN_SOURCES = 5;
const THEMES = [
  { label: 'AI 技术', pattern: /人工智能|大模型|机器学习|深度学习|提示词|算法|神经网络|AI\b|LLM\b/iu },
  { label: '保险学研究', pattern: /保险|保费|承保|理赔|精算|风险定价/u },
  { label: '专业论文', pattern: /论文|学术|研究方法|实验设计|文献综述|摘要|假设检验/u },
  { label: '增长与运营', pattern: /增长|留存|转化|获客|用户运营|北极星指标|活跃率/u },
  { label: '产品设计', pattern: /产品设计|用户体验|交互设计|原型|需求分析|可用性/u },
  { label: '商业与管理', pattern: /商业模式|市场分析|管理|战略|组织|财务/u }
];

function portraitTerms(values) {
  const text = values.join(' ');
  const themes = THEMES.map(theme => ({ label: theme.label, count: [...text.matchAll(new RegExp(theme.pattern.source, 'giu'))].length }))
    .filter(item => item.count > 0).sort((a, b) => b.count - a.count).slice(0, 3).map(item => item.label);
  const direct = keywords(values, 20).filter(word => !themes.some(theme => theme.includes(word))).slice(0, themes.length || 3);
  return { words: [...themes, ...direct].slice(0, 6), themeCount: themes.length };
}

function deriveDesktopData(sources, now = new Date()) {
  const tasks = [];
  const saved = [];
  const activity = new Map();
  const readingWords = [];
  const questionWords = [];
  let commentCount = 0;
  let answerCount = 0;
  const normalized = sources.map(source => {
    const comments = Array.isArray(source.comments) ? source.comments : [];
    const sourceTasks = [];
    const sourceSaved = [];
    const openedDay = dateKey(source.lastOpenedAt);
    if (openedDay) activity.set(openedDay, (activity.get(openedDay) || 0) + 1);
    readingWords.push(source.name.replace(/\.[^.]+$/, ''));
    readingWords.push(...(source.recap?.topics || []));
    for (const comment of comments) {
      commentCount += 1;
      readingWords.push(comment.quote);
      for (const message of comment.messages || []) {
        const day = dateKey(message.createdAt);
        if (day) activity.set(day, (activity.get(day) || 0) + 1);
        if (message.role === 'via' && message.status === 'answered') answerCount += 1;
        if (message.role !== 'user') continue;
        questionWords.push(message.text);
        for (const person of new Set(mentions(message.text))) {
          if (person.toLowerCase() === 'via') continue;
          const body = taskBody(message.text, person);
          if (!body || !/[\p{L}\p{N}]/u.test(body)) continue;
          const resolvedAt = source.todoStates?.[message.id]?.resolvedAt || null;
          const task = {
            sourceId: source.id, sourceName: source.name, sourceType: source.sourceType,
            documentPath: source.documentPath, commentId: comment.id, messageId: message.id,
            person, body, quote: comment.quote,
            createdAt: message.createdAt || comment.createdAt || source.updatedAt,
            resolvedAt
          };
          tasks.push(task);
          sourceTasks.push(task);
        }
      }
      if (comment.saved) {
        const item = {
          sourceId: source.id, sourceName: source.name, sourceType: source.sourceType,
          documentPath: source.documentPath, commentId: comment.id,
          quote: comment.quote, context: comment.contextSnapshot || '',
          savedAt: comment.savedAt || comment.createdAt || source.updatedAt,
          messages: (comment.messages || []).map(message => ({
            role: message.role, text: message.text || '', createdAt: message.createdAt || null,
            status: message.status || null
          }))
        };
        saved.push(item);
        sourceSaved.push(item);
      }
    }
    return { ...source, comments, tasks: sourceTasks, savedItems: sourceSaved };
  });
  tasks.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  saved.sort((left, right) => String(right.savedAt || '').localeCompare(String(left.savedAt || '')));
  const portraitReady = normalized.length >= PORTRAIT_MIN_SOURCES;
  const readingPortrait = portraitReady ? portraitTerms(readingWords) : { words: [], themeCount: 0 };
  const questionPortrait = portraitReady ? portraitTerms(questionWords) : { words: [], themeCount: 0 };
  return {
    sources: normalized,
    tasks,
    saved,
    activity: Object.fromEntries(activity),
    portrait: { ready: portraitReady, target: PORTRAIT_MIN_SOURCES, remaining: Math.max(0, PORTRAIT_MIN_SOURCES - normalized.length), readingThemeCount: readingPortrait.themeCount, questionThemeCount: questionPortrait.themeCount },
    readingKeywords: readingPortrait.words,
    questionKeywords: questionPortrait.words,
    metrics: {
      sources: normalized.length,
      comments: commentCount,
      viaAnswers: answerCount,
      pendingTasks: tasks.filter(task => !task.resolvedAt).length,
      saved: saved.length,
      activeDays: activity.size,
      averageReadingMinutes: null
    }
  };
}

function buildTodoMarkdown(source, person) {
  const tasks = source.tasks.filter(item => item.person === person && !item.resolvedAt);
  if (!tasks.length) throw new Error('这个对象没有未完成待办');
  return [`# ${source.name} · @${person} 待办`, '', `来源：${source.documentPath}`, '',
    ...tasks.flatMap((task, index) => [`## ${index + 1}. ${task.body}`, '', `> ${task.quote}`, '', `创建：${task.createdAt || '未知'}`, ''])].join('\n');
}

module.exports = { deriveDesktopData, mentions, taskBody, buildTodoMarkdown };
