import { source } from '../../../lib/source';
import { createFromSource } from 'fumadocs-core/search/server';
import type { Tokenizer } from '@orama/orama';

/**
 * Chinese-aware tokenizer for orama.
 * Splits CJK characters into unigrams + bigrams for substring search.
 * Falls back to simple word split for Latin text.
 */
const chineseTokenizer: Tokenizer = {
  language: 'chinese',
  normalizationCache: new Map(),

  tokenize(raw: string, _language?: string, _prop?: string, _withCache?: boolean): string[] {
    if (!raw) return [];

    const tokens: string[] = [];
    const words = raw.split(/\s+/);

    for (const word of words) {
      if (!word) continue;

      if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(word)) {
        // CJK: split into unigrams and bigrams
        for (let i = 0; i < word.length; i++) {
          tokens.push(word[i]);
          if (i < word.length - 1) {
            tokens.push(word[i] + word[i + 1]);
          }
        }
      } else {
        // Latin/numbers: lowercase whole word
        const normalized = word.toLowerCase().replace(/[^\w-]/g, '');
        if (normalized) tokens.push(normalized);
      }
    }

    return [...new Set(tokens)];
  },
};

export const { GET } = createFromSource(source, {
  tokenizer: chineseTokenizer,
  buildIndex: async (page) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = page.data as any;

    let structuredData = data.structuredData;

    const hasContent = structuredData
      && (structuredData.contents?.length > 0 || structuredData.headings?.length > 0);

    if (!hasContent) {
      if (typeof data.load === 'function') {
        try {
          const loaded = await data.load();
          if (loaded?.structuredData) structuredData = loaded.structuredData;
        } catch {}
      }
    }

    const finalHasContent = structuredData
      && (structuredData.contents?.length > 0 || structuredData.headings?.length > 0);

    if (!finalHasContent) {
      return {
        id: page.url,
        title: page.data.title ?? '',
        description: page.data.description ?? '',
        url: page.url,
        structuredData: {
          headings: [],
          contents: [
            {
              heading: undefined,
              content: [page.data.title, page.data.description]
                .filter(Boolean)
                .join(' — '),
            },
          ],
        },
      };
    }

    return {
      id: page.url,
      title: page.data.title ?? '',
      description: page.data.description ?? '',
      url: page.url,
      structuredData,
    };
  },
});

export const dynamic = 'force-dynamic';
export const revalidate = false;
