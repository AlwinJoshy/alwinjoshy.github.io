// Bakes the blog cards straight into index.html and blogArchive.html, so they show
// instantly and crawlers can read them. Run after adding a post:  node scripts/build-blogs.mjs
// Source of truth stays jsonFiles/blogList.json (template and duplicate entries are skipped).
// Per post it reads: <h1 class="blog-title">, <p class="date-small-text"> (e.g. "17 October 2026"),
// the first <img> in .blog-prime-image (cover), <meta name="post-tags" content="A, B">, and the body text
// (excerpt + reading time at ~200 words/min). It also writes each post's <title>, description and share tags.
import fs from 'fs';

const SITE = 'https://alwinjoshy.github.io/';
const list = JSON.parse(fs.readFileSync('jsonFiles/blogList.json', 'utf8'));
const strip = (h) => h.replace(/<(script|style|pre)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
const esc = (s) => s.replace(/&(?!\w+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function setMeta(html, attr, key, content) {
    const tag = `<meta ${attr}="${key}" content="${esc(content)}">`;
    const re = new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`);
    return re.test(html) ? html.replace(re, tag) : html.replace(/<\/title>/, `</title>\n    ${tag}`);
}

const seen = new Set(), posts = [];
for (const group of list.data) {
    for (const url of group.pages) {
        if (seen.has(url) || /blogTemplate/i.test(url) || !fs.existsSync(url)) continue;
        seen.add(url);
        let html = fs.readFileSync(url, 'utf8');
        const title = strip((html.match(/<h1 class="blog-title">([\s\S]*?)<\/h1>/) || [, url])[1]);
        const dateText = strip((html.match(/<p class="date-small-text">([\s\S]*?)<\/p>/) || [, ''])[1]);
        const date = new Date(dateText + ' 12:00 UTC');
        const imgBlock = (html.match(/<div class="blog-prime-image">([\s\S]*?)<\/div>/) || [, ''])[1];
        let img = (imgBlock.match(/<img[^>]*src="([^"]+)"/) || [, ''])[1];
        if (img && !/^(https?:|\/)/.test(img)) img = decodeURI(new URL(img, SITE + url).pathname.slice(1)); // site-root relative
        // share image: prefer a JPG twin of a WebP cover (better supported by link-preview crawlers)
        const shareImg = img && /\.webp$/i.test(img) && fs.existsSync(img.replace(/\.webp$/i, '.jpg')) ? img.replace(/\.webp$/i, '.jpg') : img;
        const tags = ((html.match(/<meta name="post-tags" content="([^"]*)"/) || [, ''])[1]).split(',').map((t) => t.trim()).filter(Boolean);
        const body = strip((html.match(/<div class="blog-content-details">([\s\S]*)/) || [, html])[1].replace(/<div class="copyright">[\s\S]*/, ''));
        const words = body.split(' ').length;
        const minutes = Math.max(1, Math.round(words / 200));
        const excerpt = body.length > 150 ? body.slice(0, 150).replace(/\s\S*$/, '') + '…' : body;

        const pageTitle = `${title} | Alwin Joshy`;
        const desc = excerpt.replace(/…$/, '');
        html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(pageTitle)}</title>`);
        html = setMeta(html, 'name', 'description', desc);
        html = setMeta(html, 'property', 'og:type', 'article');
        html = setMeta(html, 'property', 'og:title', pageTitle);
        html = setMeta(html, 'property', 'og:description', desc);
        html = setMeta(html, 'property', 'og:url', SITE + url);
        if (shareImg) html = setMeta(html, 'property', 'og:image', SITE + encodeURI(shareImg));
        html = setMeta(html, 'name', 'twitter:card', 'summary_large_image');
        if (shareImg) html = setMeta(html, 'name', 'twitter:image', SITE + encodeURI(shareImg));
        fs.writeFileSync(url, html);

        posts.push({ url, title, img, excerpt, tags, minutes, date, dateText });
    }
}
posts.sort((a, b) => b.date - a.date);   // newest first

const card = (p, prefix = '') => `
<a class="post-card" href="${prefix}${p.url}">
    <div class="post-card-media">${p.img ? `<img src="${prefix}${encodeURI(p.img)}" alt="${esc(p.title)}" loading="lazy" decoding="async">` : ''}</div>
    <div class="post-card-body">
        <p class="post-card-meta"><time datetime="${p.date.toISOString().slice(0, 10)}">${p.date.getUTCDate()} ${MONTHS[p.date.getUTCMonth()]} ${p.date.getUTCFullYear()}</time> &middot; ${p.minutes} min read</p>
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

// sitemap with every post
const today = new Date().toLocaleDateString('en-CA');
const urls = ['', 'blogArchive.html', 'downloadables/Technical%20Artist%20-%20ALWIN%20JOSHY%20-%20CV.pdf', ...posts.map((p) => p.url)];
fs.writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
console.log(`Built ${posts.length} posts:`, posts.map((p) => `${p.title} (${p.minutes} min)`).join(' | '));
