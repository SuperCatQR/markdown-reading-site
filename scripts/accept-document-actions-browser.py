"""Exercise original-document actions in the real reader with isolated browsers.

python scripts/accept-document-actions-browser.py --base http://127.0.0.1:5180/ --out artifacts/document-acceptance
Requires Python Playwright and Chromium. No application or snapshot files are changed.
"""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5180/')
parser.add_argument('--out', default='artifacts/document-acceptance')
args = parser.parse_args()
base = args.base.rstrip('/') + '/'
output = Path(args.out)
output.mkdir(parents=True, exist_ok=True)
single = '0e6bb3b8a12d493d90fbb6f707161526'
multi = '0724ad88f2f34abea2924007462b7f7b'
checks = []
position_script = '''() => {
 const a=[...document.querySelectorAll('.reader-article')].find(e=>e.getBoundingClientRect().bottom>90);
 const p=a?.querySelector('.reader-prose');
 const blocks=[...p?.querySelectorAll('[data-block-id]')||[]].filter(e=>e.checkVisibility());
 const b=p?.getBoundingClientRect().top<=90?blocks.find(e=>e.getBoundingClientRect().bottom>90)||blocks.at(-1):null;
 const r=b?.getBoundingClientRect();
 return {edition:a?.dataset.editionId,anchor:b?.dataset.blockId||'',offset:r?(90-r.top)/Math.max(1,r.height):0};
}'''
clipboard_script = '''() => {
 window.__documentCopies=[]; window.__documentCopyFailure=false;
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{async writeText(text){
   if(window.__documentCopyFailure)throw Error('simulated clipboard refusal');
   window.__documentCopies.push(text);
 }}});
}'''

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    def run(name, test):
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce', accept_downloads=True)
        context.add_init_script('(' + clipboard_script + ')()')
        page = context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(30000)
        errors = []
        sources = {}
        page.on('pageerror', lambda error: errors.append(str(error)))

        def original_response(response):
            path = urlparse(response.url).path
            if response.status == 200 and path.endswith('.md'):
                # CDP may decode text/markdown without a declared charset before
                # response.body() re-encodes it. APIResponse keeps raw HTTP bytes.
                original = context.request.get(response.url)
                assert original.ok, f'Original resource failed: {response.url}'
                sources[response.url] = original.body()
        page.on('response', original_response)
        start = time.monotonic()
        try:
            evidence = test(page, sources)
            page.wait_for_timeout(350)
            assert not errors, f'Runtime errors: {errors}'
            result = {'name': name, 'status': 'pass', 'evidence': evidence, 'errors': []}
        except Exception as error:
            result = {'name': name, 'status': 'fail', 'evidence': str(error), 'errors': errors}
            try:
                page.screenshot(path=str(output / f'{len(checks)+1:02d}-failure.png'), full_page=False)
            except Exception as screenshot_error:
                result['screenshot_error'] = str(screenshot_error)
        result['seconds'] = round(time.monotonic() - start, 2)
        checks.append(result)
        print(json.dumps(result, ensure_ascii=True), flush=True)
        context.close()

    def visit(page, route):
        page.goto(base + '#' + route)
        expect(page.locator('.reader-prose').first).to_be_visible()
        expect(page.locator('.reader-article').first).to_have_attribute('data-edition-id', route.split('?')[0].split('/')[-1])

    def more(page):
        page.locator('[data-tool="more"]').click()
        expect(page.locator('[data-action="copy-markdown"]')).to_be_visible()
        page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        expect(page.locator('.tool-drawer')).to_have_attribute('aria-busy', 'false')

    def source_bytes(sources, edition, view):
        suffix = f'{"body" if view == "read" else "review"}-{edition}.md'
        candidates = [body for url, body in sources.items() if urlparse(url).path.endswith(suffix)]
        assert len(candidates) == 1, f'Expected one actual repository source response for {suffix}; got {list(sources)}'
        return candidates[0]

    def copied(page, previous_count):
        page.wait_for_function('(count) => window.__documentCopies.length > count', arg=previous_count)
        expect(page.locator('[data-document-action-status]')).to_have_text(re.compile('已复制'))
        return page.evaluate('window.__documentCopies.at(-1)')

    def original_actions(page, sources, view):
        visit(page, f'/{view}/{single}')
        raw = source_bytes(sources, single, view)
        page.locator('.reader-prose [data-block-id]').filter(visible=True).nth(5).evaluate('e=>window.scrollTo({top:scrollY+e.getBoundingClientRect().top-90+e.getBoundingClientRect().height*.2,behavior:"instant"})')
        more(page)
        position = page.evaluate(position_script)
        assert position['anchor'], f'Cannot establish a real {view} paragraph for sharing: {position}'
        page.locator('[data-action="copy-paragraph-link"]').click()
        shared = copied(page, 0)
        path, query = urlparse(shared).fragment.split('?', 1)
        assert path == f'/{view}/{single}' and parse_qs(query).get('block') == [position['anchor']], shared
        page.locator('[data-action="copy-markdown"]').click()
        text = copied(page, 1)
        assert text.encode('utf-8') == raw, f'Copied bytes {len(text.encode("utf-8"))} differ from original {len(raw)} bytes'
        with page.expect_download() as download_event:
            page.locator('[data-action="download-markdown"]').click()
        download = download_event.value
        downloaded = Path(download.path()).read_bytes()
        assert hashlib.sha256(downloaded).digest() == hashlib.sha256(raw).digest(), 'Download bytes differ from original asset'
        assert download.suggested_filename.endswith('-正文.md' if view == 'read' else '-核验参照.md')
        return {'view': view, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'filename': download.suggested_filename, 'shared_block': position['anchor']}

    run('Body copy and download preserve exact repository Markdown bytes', lambda page, sources: original_actions(page, sources, 'read'))
    run('Verification copy and download preserve exact repository Markdown bytes', lambda page, sources: original_actions(page, sources, 'verify'))

    def clipboard_recovery(page, sources):
        visit(page, '/read/' + single)
        raw = source_bytes(sources, single, 'read')
        more(page)
        page.evaluate('window.__documentCopyFailure=true')
        page.locator('[data-action="copy-markdown"]').click()
        manual = page.locator('[data-document-action-output]')
        expect(manual).to_be_visible()
        assert manual.input_value().encode('utf-8') == raw
        page.evaluate('window.__documentCopyFailure=false')
        page.locator('[data-action="copy-markdown"]').click()
        assert copied(page, 0).encode('utf-8') == raw
        expect(manual).to_be_hidden()
        assert manual.input_value() == ''
        return {'manual_bytes': len(raw), 'success_hides_manual_output': True}
    run('Refused clipboard exposes full manual text and later success clears it', clipboard_recovery)

    def next_part_actions(page, sources):
        visit(page, '/read/' + multi)
        link = page.locator('.reader-end').get_by_role('link', name=re.compile('下一部分'))
        second = link.get_attribute('href').split('/read/')[1].split('?')[0]
        link.click()
        expect(page.locator('.reader-article')).to_have_count(1)
        expect(page.locator('.reader-article')).to_have_attribute('data-edition-id', second)
        assert second != multi, f'Next P duplicates starting edition: {second}'
        # This P is short. Bring its first real paragraph into view without
        # assuming the viewport can scroll far enough to establish an anchor.
        page.locator('.reader-prose [data-block-id]').filter(visible=True).first.scroll_into_view_if_needed()
        page.wait_for_timeout(350)
        more(page)
        position = page.evaluate(position_script)
        assert position['edition'] == second, f'Visible position does not identify second-part prose: {position}'
        page.locator('[data-action="copy-paragraph-link"]').click()
        url = copied(page, 0)
        fragment = urlparse(url).fragment
        path, query = fragment.split('?', 1) if '?' in fragment else (fragment, '')
        values = parse_qs(query)
        assert path == '/read/' + second and 'flow' not in values, url
        if position['anchor']:
            assert values.get('block') == [position['anchor']], url
        page.locator('[data-action="copy-markdown"]').click()
        assert copied(page, 1).encode('utf-8') == source_bytes(sources, second, 'read')
        return {'second_edition': second, 'block': position['anchor'], 'copied_url': url}
    run('Independent next P shares and copies its accurate current edition', next_part_actions)

    def reset_preferences(page, sources):
        visit(page, '/read/' + single)
        page.locator('[data-action="theme"]').click()
        more(page)
        page.locator('[data-tool="settings"]').click()
        for field, value in [('size', '21'), ('width', '920'), ('lineHeight', '2.1'), ('font', 'sans')]:
            page.locator(f'[data-preference="{field}"]').select_option(value)
        page.evaluate('() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        block = page.locator('.reader-prose [data-block-id]').nth(5)
        block.evaluate('e=>window.scrollTo({top:scrollY+e.getBoundingClientRect().top-90+e.getBoundingClientRect().height*.3,behavior:"instant"})')
        page.wait_for_timeout(350)
        before = page.evaluate(position_script)
        page.locator('[data-action="reset-preferences"]').click()
        expect(page.locator('[data-preference="size"]')).to_have_value('17')
        expect(page.locator('.tool-drawer')).to_have_attribute('aria-busy', 'false')
        # Reset changes font and layout; the owned restoration settles after
        # rendered frames. Keep the exact semantic assertion and wait for that
        # observable result rather than sampling the intermediate geometry.
        page.wait_for_function('''before => {
          const a=document.querySelector('.reader-article');
          const p=a?.querySelector('.reader-prose');
          const b=p?.getBoundingClientRect().top<=90 ? [...p.querySelectorAll('[data-block-id]')].find(e=>e.checkVisibility() && e.getBoundingClientRect().bottom>90) : null;
          const r=b?.getBoundingClientRect();
          return a?.dataset.editionId===before.edition && b?.dataset.blockId===before.anchor
            && r && Math.abs((90-r.top)/Math.max(1,r.height)-before.offset)<.04;
        }''', arg=before)
        after = page.evaluate(position_script)
        assert before['edition'] == after['edition'] and before['anchor'] == after['anchor'], f'Reset changes block: {before}->{after}'
        assert abs(before['offset'] - after['offset']) < .04, f'Reset changes paragraph fraction: {before}->{after}'
        values = page.evaluate('''() => {
          const s=getComputedStyle(document.documentElement);
          return {theme:document.documentElement.dataset.refactorTheme,size:s.getPropertyValue('--reader-size').trim(),width:s.getPropertyValue('--reader-width').trim(),line:s.getPropertyValue('--reader-line-height').trim(),font:s.getPropertyValue('--reader-font').trim()};
        }''')
        assert values['theme'] == 'dark' and values['size'] == '17px' and values['width'] == '760px' and values['line'] == '1.95' and 'Georgia' in values['font'], values
        for field, value in [('size', '17'), ('width', '760'), ('lineHeight', '1.95'), ('font', 'serif')]:
            expect(page.locator(f'[data-preference="{field}"]')).to_have_value(value)
        return {'preferences': values, 'before': before, 'after': after}
    run('Reset defaults retains theme and semantic paragraph position', reset_preferences)

    def skip_content(page, sources):
        visit(page, '/read/' + single)
        before = page.evaluate('location.hash')
        page.locator('[data-action="skip-content"]').focus()
        page.keyboard.press('Enter')
        assert page.evaluate('document.activeElement===document.querySelector("main")')
        assert page.evaluate('location.hash') == before
        return {'hash': before, 'focused_main': True}
    run('Skip content focuses main without changing the reader route', skip_content)

    report = {'base': base, 'browser': browser.version, 'checks': checks,
              'summary': {'pass': sum(check['status'] == 'pass' for check in checks), 'fail': sum(check['status'] == 'fail' for check in checks)}}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
print(json.dumps(report['summary']), flush=True)
raise SystemExit(1 if report['summary']['fail'] else 0)
