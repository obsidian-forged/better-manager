export interface SearchableSetting {
    name: string;
    description: string;
}

const normalize = (value: string): string => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/** 有限编辑距离只用于完整单词，不把远隔的字母拼成命中；Bound typo tolerance to whole words. */
function editDistance(left: string, right: string, limit: number): number {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    let row = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i++) {
        const next = [i];
        for (let j = 1; j <= right.length; j++) {
            next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
        }
        if (Math.min(...next) > limit) return limit + 1;
        row = next;
    }
    return row[right.length];
}

function termScore(text: string, term: string): number {
    if (text === term) return 100;
    const index = text.indexOf(term);
    if (index >= 0) return index === 0 ? 85 : 65;
    // 短词与中文采用连续片段匹配，避免单字容错导致无关命中；Keep short/CJK matches contiguous.
    if (!/^[a-z0-9]{4,40}$/.test(term)) return 0;
    const limit = term.length >= 8 ? 2 : 1;
    let best = 0;
    for (const word of text.match(/[a-z0-9]+/g) ?? []) {
        if (word.length < 4 || Math.abs(word.length - term.length) > limit) continue;
        const distance = editDistance(word, term, limit);
        if (distance <= limit) best = Math.max(best, 40 - distance * 10);
    }
    return best;
}

/** 名称权重高于描述，每个关键词都须命中；Rank titles above descriptions and require every query term. */
export function rankSettings<T extends SearchableSetting>(items: readonly T[], query: string): T[] {
    const phrase = normalize(query);
    if (!phrase) return [];
    const terms = [...new Set(phrase.split(' '))];
    return items.map((item, index) => {
        const name = normalize(item.name);
        const description = normalize(item.description);
        let score = 0;
        for (const term of terms) {
            const match = Math.max(termScore(name, term) * 3, termScore(description, term));
            if (!match) return { item, index, score: 0 };
            score += match;
        }
        if (name === phrase) score += 500;
        else if (name.includes(phrase)) score += 150;
        else if (description.includes(phrase)) score += 30;
        return { item, index, score };
    }).filter(match => match.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(match => match.item);
}
