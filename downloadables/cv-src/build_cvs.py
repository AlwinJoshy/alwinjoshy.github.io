#!/usr/bin/env python3
"""Build the three role CVs (Technical Artist, Unity Engineer, Lighting Artist).

    python3 downloadables/cv-src/build_cvs.py

Reads cv-content.json + template.html, writes cv-<role>.html (kept in the repo as the
readable source) and "downloadables/Alwin Joshy - <Role> - CV.pdf".
Needs: Google Chrome (headless print-to-PDF), Pillow (thumbnails), pikepdf (PDF metadata).
Links inside the PDFs carry ?role=<r>&ref=cv-<r> so GoatCounter shows CV clicks (see SEO-README).
"""
import html, json, os, shutil, subprocess, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent              # repo root
OUT = HERE.parent                      # downloadables/
SITE = 'https://alwinjoshy.github.io/'
CHROME = os.environ.get('CHROME') or shutil.which('google-chrome') or shutil.which('chromium') or 'google-chrome'
E = lambda s: html.escape(str(s), quote=True)


def thumb(src, dst, size, quality, crop=None):
    im = Image.open(ROOT / src).convert('RGB')
    if crop:                               # optional [x0, y0, x1, y1] in source pixels (frame the subject, drop logos/captions)
        im = im.crop(tuple(crop))
    w, h = size
    r = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    im.crop((x, y, x + w, y + h)).save(dst, 'JPEG', quality=quality, optimize=True, progressive=True)


def url(link, role, frag=''):
    q = f'?role={role}&ref=cv-{role}'
    if link.startswith('http'):
        return link
    if link.startswith('home'):
        return SITE + q + link[4:]
    return SITE + link + q


def build(role, d, tpl):
    R = d['roles'][role]
    P = d['person']
    a = lambda href, text, cls='': f'<a href="{E(href)}"{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{E(text)}</a>'
    home = url('home', role)
    contact = ' <span class="sep">·</span> '.join([
        E(P['location']), a('mailto:' + P['email'], P['email']),
        a(home, 'alwinjoshy.github.io'), a(P['linkedin'], 'linkedin.com/in/0merta'), a(P['github'], 'github.com/AlwinJoshy')])

    thumbs = ''.join(
        f'<a class="thumb" href="{E(url(d["images"][k]["link"], role))}"><img src="img/{k}.jpg" alt="{E(d["images"][k]["caption"])}">'
        f'<span>{E(d["images"][k]["caption"])}</span></a>' for k in R['thumbs'])

    skills = ''.join(f'<li><b>{E(k)}:</b> {E(v)}</li>' for k, v in R['skills'])

    exp = []
    for e in d['experience']:
        order = R['order'].get(e['id'], range(len(e['bullets'])))
        bl = ''.join(f'<li>{E(e["bullets"][i])}</li>' for i in order)
        org = a(e['link'], e['org']) if e.get('link') else E(e['org'])
        when = E(e['dates']) + (f' · {E(e["where"])}' if e.get('where') else '')
        exp.append(f'<div class="job"><h3>{E(e["role"])} <span class="org">| {org}</span></h3>'
                   f'<p class="dates">{when}</p><ul>{bl}</ul></div>')
    exp.append(f'<p class="earlier">{E(d["earlier"])}</p>')

    projects = ''.join(
        f'<li><b>{a(url(p["link"], role), p["name"])}</b> <span class="meta">({E(p["meta"])})</span>: {E(p["text"])}</li>'
        for p in (d['projects'][k] for k in R['projects']))
    edu = ''.join(f'<h3>{E(x["what"])} <span class="org">| {E(x["where"])}</span></h3>'
                  f'<p class="dates">{E(x["dates"])} · {E(x["note"])}</p>' for x in d['education'])
    ach = ''.join(f'<li>{E(x)}</li>' for x in d['achievements'])

    page = tpl
    for k, v in {
        'TITLE': E(f'{P["name"]} - {R["title"]} - CV'), 'NAME': E(P['name']), 'ROLE': E(R['title']),
        'SUBTITLE': E(R['subtitle']), 'CONTACT': contact, 'SUMMARY': E(R['summary']), 'THUMBS': thumbs,
        'SKILLS': skills, 'EXPERIENCE': ''.join(exp), 'PROJECTS': projects, 'EDUCATION': edu,
        'ACHIEVEMENTS': ach, 'LANGUAGES': E(d['languages']), 'HOME': E(home), 'HOMETEXT': 'alwinjoshy.github.io',
        'KEYWORDS': E(R['keywords']), 'CTAIMG': E(R.get('cta', 'cta')),
    }.items():
        page = page.replace('{{' + k + '}}', v)
    src = HERE / f'cv-{role}.html'
    src.write_text(page, encoding='utf-8', newline='\n')

    pdf = OUT / R['file']
    subprocess.run([CHROME, '--headless=new', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer',
                    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000',
                    f'--print-to-pdf={pdf}', src.as_uri()], check=True, capture_output=True)
    try:
        import pikepdf
        with pikepdf.open(pdf, allow_overwriting_input=True) as doc:
            info = doc.docinfo
            info['/Title'] = f'{P["name"]} - {R["title"]} - CV'
            info['/Author'] = P['name']
            info['/Subject'] = f'CV of {P["name"]}, {R["title"]}, {P["location"]}'
            info['/Keywords'] = R['keywords']
            with doc.open_metadata(set_pikepdf_as_editor=False) as m:
                m.load_from_docinfo(info)
            doc.save(pdf)
    except ImportError:
        print('pikepdf not installed: PDF built without author/keywords metadata', file=sys.stderr)
    print(f'{pdf.name}: {pdf.stat().st_size // 1024} KB')


def main():
    d = json.loads((HERE / 'cv-content.json').read_text(encoding='utf-8'))
    tpl = (HERE / 'template.html').read_text(encoding='utf-8')
    (HERE / 'img').mkdir(exist_ok=True)
    for k, im in d['images'].items():
        thumb(im['src'], HERE / 'img' / f'{k}.jpg', (640, 320) if k.startswith('cta') else (400, 250), 72, im.get('crop'))
    for role in (sys.argv[1:] or d['roles']):
        build(role, d, tpl)


if __name__ == '__main__':
    main()
