import { HELP_ARTICLES, HELP_FAQS } from '../../src/lib/help/content'
import fs from 'fs'
fs.writeFileSync('tests/audit/out/articles.json', JSON.stringify({ count: HELP_ARTICLES.length, faqCount: HELP_FAQS.length, articles: HELP_ARTICLES }, null, 2))
console.log('articles:', HELP_ARTICLES.length, 'faqs:', HELP_FAQS.length)
const byCat: Record<string, number> = {}
for (const a of HELP_ARTICLES) byCat[a.category] = (byCat[a.category] ?? 0) + 1
console.log(JSON.stringify(byCat, null, 2))
