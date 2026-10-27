// Bakes the blog cards straight into index.html and blogArchive.html, so they show
// instantly and crawlers can read them. Run after adding or editing a post:  node scripts/build-blogs.mjs
// Source of truth stays jsonFiles/blogList.json (template and duplicate entries are skipped).
//
// Per post it reads (see SEO-README.md for the full checklist):
//   <h1 class="blog-title">             -> headline, card title, <title> ("<h1> | Alwin Joshy")
//   <p class="date-small-text">          -> datePublished, e.g. "17 October 2026"
//   first <img> in .blog-prime-image     -> cover / share image (+ its alt, width, height)
//   <meta name="post-summary">           -> meta description + card excerpt (aim for 120-160 characters)
//   <meta name="post-tags">              -> card tags, article:tag, keywords ("Unity, Shaders")
//   <meta name="post-seo-title">         -> optional, replaces the <h1> in <title> only
//   <meta name="post-updated">           -> optional YYYY-MM-DD, dateModified + sitemap lastmod after a real content update
// and writes, per post, one managed block between <!-- SEO:START --> and <!-- SEO:END --> in <head>:
// description, robots, canonical, icons, Open Graph, Twitter card, article:* tags and BlogPosting +
// BreadcrumbList JSON-LD. Any older loose copies of those tags (and a template's noindex) are removed.
// It also rebuilds the Blog JSON-LD in blogArchive.html, sitemap.xml and feed.xml (RSS).
import fs from 'fs';
import { execSync } from 'child_process';

const SITE = 'https://alwinjoshy.github.io/';
const AUTHOR = { '@type': 'Person', '@id': SITE + '#person', name: 'Alwin Joshy', url: SITE, jobTitle: 'Technical Artist' };
const BLOG = { '@type': 'Blog', '@id': SITE + 'blogArchive.html#blog', name: 'Alwin Joshy – Technical Art Blog', url: SITE + 'blogArchive.html' };
const list = JSON.parse(fs.readFileSync('jsonFiles/blogList.json', 'utf8'));
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&[a-z]+;/g, ' ');
const strip = (h) => decode(h.replace(/<(script|style|pre)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&(?!\w+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const meta = (html, name) => decode((html.match(new RegExp(`<meta name="${name}" content="([^"]*)"`)) || [, ''])[1]).trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const iso = (d) => d.toISOString().slice(0, 10);
const abs = (p) => SITE + encodeURI(p);

// pixel size of a jpg/png/gif/webp (for og:image:width/height when the <img> has no width/height)
function imageSize(file) {
    try {
        const b = fs.readFileSync(file);
        if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
        if (b.toString('ascii', 0, 3) === 'GIF') return [b.readUInt16LE(6), b.readUInt16LE(8)];
        if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
            const t = b.toString('ascii', 12, 16);
            if (t === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
            if (t === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
            if (t === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
        }
        if (b[0] === 0xff && b[1] === 0xd8) {
            for (let i = 2; i < b.length;) {
                if (b[i] !== 0xff) { i++; continue; }
                const m = b[i + 1], len = b.readUInt16BE(i + 2);
                if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
                i += 2 + len;
            }
        }
    } catch (e) { /* missing file */ }
    return null;
}

// remove loose copies of tags the managed block now owns, then (re)insert the block after </title>
function putSeoBlock(html, block) {
    html = html.replace(/\n?[ \t]*<!-- SEO:START[\s\S]*?<!-- SEO:END -->/, '');
    html = html.replace(/\n?[ \t]*<meta (?:name|property)="(?:description|robots|author|og:[^"]+|twitter:[^"]+|article:[^"]+)"[^>]*>/g, '');
    html = html.replace(/\n?[ \t]*<link rel="(?:canonical|apple-touch-icon|manifest|alternate)"[^>]*>/g, '');
    html = html.replace(/\n?[ \t]*<link rel="icon" type="image\/png"[^>]*>/g, '');
    return html.replace(/(<\/title>)/, `$1\n    ${block}`);
}

// GoatCounter + role memory on every post and the archive (CV links arrive as ?role=ta|ue|la&ref=cv-..; the
// homepage reads sessionStorage.cvRole so its Download CV buttons serve the same role's PDF). See SEO-README.
const ANALYTICS = [
    `<script data-goatcounter="https://alwinjoshy.goatcounter.com/count" async src="//gc.zgo.at/count.js"></script>`,
    `<script>try{var cvR=(new URLSearchParams(location.search).get('role')||'').toLowerCase();if(/^(ta|ue|la)$/.test(cvR))sessionStorage.setItem('cvRole',cvR)}catch(e){}</script>`,
];

const seen = new Set(), posts = [], warnings = [];
for (const group of list.data) {
    for (const url of group.pages) {
        if (seen.has(url) || /blogTemplate/i.test(url) || !fs.existsSync(url)) continue;
        seen.add(url);
        let html = fs.readFileSync(url, 'utf8');
        const src = html.replace(/<!--(?! SEO:)[\s\S]*?-->/g, ''); // read fields outside HTML comments
        const title = strip((src.match(/<h1 class="blog-title">([\s\S]*?)<\/h1>/) || [, url])[1]);
        const dateText = strip((src.match(/<p class="date-small-text">([\s\S]*?)<\/p>/) || [, ''])[1]);
        const date = new Date(dateText + ' 12:00 UTC');
        if (isNaN(date)) { warnings.push(`${url}: SKIPPED, can't read the date "${dateText}" (use e.g. "17 October 2026")`); continue; }
        const imgBlock = (src.match(/<div class="blog-prime-image">([\s\S]*?)<\/div>/) || [, ''])[1];
        const imgTag = (imgBlock.match(/<img[^>]*>/) || [''])[0];
        let img = (imgTag.match(/src="([^"]+)"/) || [, ''])[1];
        const imgAlt = decode((imgTag.match(/alt="([^"]*)"/) || [, ''])[1]);
        if (img && !/^(https?:|\/)/.test(img)) img = decodeURI(new URL(img, SITE + url).pathname.slice(1)); // site-root relative
        // share image: prefer a JPG twin of a WebP/GIF cover (better supported by link-preview crawlers)
        const twin = img && img.replace(/\.(webp|gif)$/i, '.jpg');
        const shareImg = twin && twin !== img && fs.existsSync(twin) ? twin : img;
        const size = shareImg ? imageSize(shareImg) : null;
        const tags = meta(src, 'post-tags').split(',').map((t) => t.trim()).filter(Boolean);
        const body = strip((src.match(/<div class="blog-content-details">([\s\S]*)/) || [, src])[1].replace(/<div class="copyright">[\s\S]*/, ''));
        const words = body.split(' ').length;
        const minutes = Math.max(1, Math.round(words / 200));
        const summary = meta(src, 'post-summary');
        const excerpt = summary || (body.length > 150 ? body.slice(0, 150).replace(/\s\S*$/, '') + '…' : body);
        const updated = meta(src, 'post-updated');
        const modified = /^\d{4}-\d{2}-\d{2}$/.test(updated) ? updated : iso(date);
        if (!summary) warnings.push(`${url}: no <meta name="post-summary"> (description falls back to the first 150 characters)`);
        if (!imgAlt) warnings.push(`${url}: cover image has no alt text`);
        if (/TODO:/.test(src.replace(/<title>[^<]*<\/title>|<!-- SEO:START[\s\S]*?SEO:END -->/g, ''))) warnings.push(`${url}: still contains a TODO: placeholder`);

        const pageUrl = SITE + url;
        const pageTitle = `${meta(src, 'post-seo-title') || title} | Alwin Joshy`;
        const desc = excerpt.replace(/…$/, '');
        const imgUrl = shareImg ? abs(shareImg) : SITE + 'images/og-hero.jpg';
        const L = [
            `<meta name="description" content="${esc(desc)}">`,
            `<meta name="robots" content="index, follow, max-image-preview:large">`,
            `<meta name="author" content="Alwin Joshy">`,
            `<link rel="canonical" href="${pageUrl}">`,
            `<link rel="icon" type="image/png" sizes="96x96" href="/images/icons/favicon-96.png">`,
            `<link rel="apple-touch-icon" sizes="180x180" href="/images/icons/apple-touch-icon.png">`,
            `<link rel="manifest" href="/site.webmanifest">`,
            `<link rel="alternate" type="application/rss+xml" title="Alwin Joshy, technical art blog" href="${SITE}feed.xml">`,
            `<meta property="og:type" content="article">`,
            `<meta property="og:site_name" content="Alwin Joshy">`,
            `<meta property="og:locale" content="en_GB">`,
            `<meta property="og:title" content="${esc(pageTitle)}">`,
            `<meta property="og:description" content="${esc(desc)}">`,
            `<meta property="og:url" content="${pageUrl}">`,
            `<meta property="og:image" content="${imgUrl}">`,
            ...(size ? [`<meta property="og:image:width" content="${size[0]}">`, `<meta property="og:image:height" content="${size[1]}">`] : []),
            ...(imgAlt ? [`<meta property="og:image:alt" content="${esc(imgAlt)}">`] : []),
            `<meta property="article:published_time" content="${iso(date)}">`,
            `<meta property="article:modified_time" content="${modified}">`,
            `<meta property="article:author" content="${SITE}">`,
            ...tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`),
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:title" content="${esc(pageTitle)}">`,
            `<meta name="twitter:description" content="${esc(desc)}">`,
            `<meta name="twitter:image" content="${imgUrl}">`,
            ...(imgAlt ? [`<meta name="twitter:image:alt" content="${esc(imgAlt)}">`] : []),
            ld({
                '@context': 'https://schema.org',
                '@graph': [
                    {
                        '@type': 'BlogPosting', '@id': pageUrl + '#post', headline: title.slice(0, 110), description: desc,
                        image: size ? { '@type': 'ImageObject', url: imgUrl, width: size[0], height: size[1] } : imgUrl,
                        datePublished: iso(date), dateModified: modified, author: AUTHOR, publisher: { '@id': SITE + '#person' },
                        mainEntityOfPage: { '@type': 'WebPage', '@id': pageUrl }, url: pageUrl, isPartOf: BLOG,
                        ...(tags.length ? { keywords: tags.join(', ') } : {}), wordCount: words, timeRequired: `PT${minutes}M`, inLanguage: 'en',
                    },
                    {
                        '@type': 'BreadcrumbList', itemListElement: [
                            { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
                            { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + 'blogArchive.html' },
                            { '@type': 'ListItem', position: 3, name: title, item: pageUrl },
                        ],
                    },
                ],
            }),
            ...ANALYTICS,
        ];
        const block = `<!-- SEO:START (generated by scripts/build-blogs.mjs, edit the post-* fields instead) -->\n    ${L.join('\n    ')}\n    <!-- SEO:END -->`;
        html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(pageTitle)}</title>`);
        html = putSeoBlock(html, block);
        fs.writeFileSync(url, html);

        posts.push({ url, title, img, imgAlt, imgUrl, excerpt, desc, tags, minutes, date, dateText, modified });
    }
}
posts.sort((a, b) => b.date - a.date);   // newest first

const card = (p, prefix = '') => `
<a class="post-card" href="${prefix}${p.url}">
    <div class="post-card-media">${p.img ? `<img src="${prefix}${encodeURI(p.img)}" alt="${esc(p.imgAlt || p.title)}" loading="lazy" decoding="async">` : ''}</div>
    <div class="post-card-body">
        <p class="post-card-meta"><time datetime="${iso(p.date)}">${p.date.getUTCDate()} ${MONTHS[p.date.getUTCMonth()]} ${p.date.getUTCFullYear()}</time> &middot; ${p.minutes} min read</p>
        <h3>${esc(p.title)}</h3>
        <p class="post-card-excerpt">${esc(p.excerpt)}</p>
        ${p.tags.length ? `<ul class="tag-list">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <span class="post-card-cta">Read post</span>
    </div>
</a>`;

const years = [...new Set(posts.map((p) => p.date.getUTCFullYear()))];
const archive = years.map((y) => `
<div class="blog-year-section">
    <h2 class="subtitle">${y}</h2>
    <div class="post-grid">${posts.filter((p) => p.date.getUTCFullYear() === y).map((p) => card(p)).join('')}
    </div>
</div>`).join('');

function inject(file, content, scriptToDrop) {
    let html = fs.readFileSync(file, 'utf8');
    const block = `<!-- BLOGS:START (generated by scripts/build-blogs.mjs, do not edit) -->${content}\n<!-- BLOGS:END -->`;
    if (html.includes('<!-- BLOGS:START')) html = html.replace(/<!-- BLOGS:START[\s\S]*?<!-- BLOGS:END -->/, block);
    else html = html.replace(/(<div[^>]*id="all-blogs-list"[^>]*>)/, `$1\n${block}`);
    html = html.replace(new RegExp(`\\s*<script[^>]*${scriptToDrop}[^>]*></script>`), ''); // old runtime loader
    fs.writeFileSync(file, html);
}
inject('index.html', posts.slice(0, 3).map((p) => card(p)).join(''), 'loadlastfourblogs\\.js');
inject('blogArchive.html', archive, 'loadblogsfromfolder\\.js');

// Blog + post list JSON-LD in blogArchive.html (managed block in <head>)
{
    let html = fs.readFileSync('blogArchive.html', 'utf8');
    const block = `<!-- SEO:START (generated by scripts/build-blogs.mjs) -->\n    ${ld({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CollectionPage', '@id': SITE + 'blogArchive.html', url: SITE + 'blogArchive.html', name: 'Technical Art Blog | Alwin Joshy',
                isPartOf: { '@id': SITE + '#website' }, about: { '@id': SITE + '#person' }, mainEntity: { '@id': BLOG['@id'] }, inLanguage: 'en',
                breadcrumb: { '@type': 'BreadcrumbList', itemListElement: [
                    { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
                    { '@type': 'ListItem', position: 2, name: 'Blog', item: SITE + 'blogArchive.html' }] },
            },
            {
                ...BLOG, description: 'Technical art write-ups by Alwin Joshy: shaders, scene lighting, performance optimisation and Unity tools.',
                author: AUTHOR, publisher: { '@id': SITE + '#person' }, inLanguage: 'en',
                blogPost: posts.map((p) => ({ '@type': 'BlogPosting', '@id': SITE + p.url + '#post', headline: p.title.slice(0, 110), url: SITE + p.url,
                    datePublished: iso(p.date), dateModified: p.modified, image: p.imgUrl, author: { '@id': SITE + '#person' } })),
            },
        ],
    })}\n    ${ANALYTICS.join('\n    ')}\n    <!-- SEO:END -->`;
    html = html.replace(/\n?[ \t]*<!-- SEO:START[\s\S]*?<!-- SEO:END -->/, '').replace(/(<\/title>)/, `$1\n    ${block}`);
    fs.writeFileSync('blogArchive.html', html);
}

// sitemap with every post (lastmod = post-updated or publish date; home = today; archive = newest post; CV = its last git commit)
const today = new Date().toLocaleDateString('en-CA');
const CV = 'downloadables/Alwin Joshy - Technical Artist - CV.pdf'; // default CV (the role CVs are built by downloadables/cv-src/build_cvs.py)
let cvDate = today;
try { cvDate = execSync(`git log -1 --format=%cs -- "${CV}"`, { encoding: 'utf8' }).trim() || today; } catch (e) { /* not a git checkout */ }
const newest = posts.reduce((m, p) => (p.modified > m ? p.modified : m), '');
const urls = [
    ['', today], ['blogArchive.html', newest || today],
    [encodeURI(CV), cvDate],
    ...posts.map((p) => [p.url, p.modified]),
];
fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, d]) => `  <url><loc>${SITE}${u}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`);

// RSS feed
const rfc = (d) => new Date(d).toUTCString();
fs.writeFileSync('feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Alwin Joshy – Technical Art Blog</title>
  <link>${SITE}blogArchive.html</link>
  <atom:link href="${SITE}feed.xml" rel="self" type="application/rss+xml"/>
  <description>Write-ups by Alwin Joshy, Technical Artist and Unity Engineer: shaders, scene lighting, performance optimisation and Unity tools.</description>
  <language>en</language>
${posts.map((p) => `  <item>
    <title>${xml(p.title)}</title>
    <link>${SITE}${p.url}</link>
    <guid isPermaLink="true">${SITE}${p.url}</guid>
    <pubDate>${rfc(p.date)}</pubDate>
    <description>${xml(p.desc)}</description>
${p.tags.map((t) => `    <category>${xml(t)}</category>`).join('\n')}
  </item>`).join('\n')}
</channel>
</rss>
`);

console.log(`Built ${posts.length} posts:`, posts.map((p) => `${p.title} (${p.minutes} min)`).join(' | '));
if (warnings.length) console.log('\nCheck these:\n- ' + warnings.join('\n- '));
