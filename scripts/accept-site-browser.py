"""Audit the real production frontend. Requires Python Playwright and Chromium.

python scripts/accept-site-browser.py --base http://127.0.0.1:5180/ --out .tmp/site-acceptance
Each failed requirement is recorded; the process exits 1 if acceptance fails.
"""
import argparse
import json
import time
from pathlib import Path
from urllib.parse import quote
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--base', default='http://127.0.0.1:5180/')
parser.add_argument('--out', default='.tmp/site-acceptance')
args = parser.parse_args()
output = Path(args.out)
output.mkdir(parents=True, exist_ok=True)
base = args.base.rstrip('/') + '/'
catalog = json.loads((Path(__file__).resolve().parents[1] / 'draft-content/catalog.json').read_text(encoding='utf-8'))
single = '0e6bb3b8a12d493d90fbb6f707161526'
multi = '0724ad88f2f34abea2924007462b7f7b'
history_key = 'reader-refactor-history-v1'
checks = []
position_script = '''() => {
  const a=[...document.querySelectorAll('.reader-article')].find(e=>e.getBoundingClientRect().bottom>90);
  const p=a?.querySelector('.reader-prose');
  const visible=[...p?.querySelectorAll('[data-block-id]')||[]].filter(e=>e.checkVisibility());
  const b=p?.getBoundingClientRect().top<=90 ? visible.find(e=>e.getBoundingClientRect().bottom>90)||visible.at(-1) : null;
  const r=b?.getBoundingClientRect();
  return { y:scrollY, edition:a?.dataset.editionId, anchor:b?.dataset.blockId||'', offset:r?(90-r.top)/Math.max(1,r.height):0 };
}'''

def assert_position(before, after, message):
    assert before['edition'] == after['edition'] and before['anchor'] == after['anchor'], f'{message}: {before} -> {after}'
    assert abs(before['offset'] - after['offset']) < .04, f'{message} offset: {before} -> {after}'

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    page = context.new_page()
    page.set_default_timeout(15000)
    page.set_default_navigation_timeout(30000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def visit(route, reader=False, listing=False, fresh=False):
        page.goto(base + '#' + route)
        if fresh:
            page.reload()
        if reader:
            expect(page.locator('.reader-prose')).to_be_visible()
            expect(page.locator('.reader-article').first).to_have_attribute('data-edition-id', route.split('?')[0].split('/')[-1])
            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        if listing:
            expect(page.locator('.results-section')).to_be_visible()
            expect(page.locator('.loading-state')).to_have_count(0, timeout=30000)

    def run(name, severity, function):
        global page, context, errors
        context.close()
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
        page = context.new_page()
        page.set_default_timeout(15000)
        page.set_default_navigation_timeout(30000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        start = time.monotonic()
        before_errors = len(errors)
        try:
            evidence = function()
            checks.append({'name': name, 'status': 'pass', 'severity': severity, 'evidence': evidence})
        except Exception as error:
            checks.append({'name': name, 'status': 'fail', 'severity': severity, 'evidence': str(error), 'errors': errors[before_errors:]})
            page.screenshot(path=str(output / f'{len(checks):02d}-failure.png'))
        checks[-1]['seconds'] = round(time.monotonic() - start, 2)
        print(json.dumps(checks[-1], ensure_ascii=True), flush=True)

    def home_layout():
        metrics = []
        for width in [320, 390, 900, 901, 1366, 2048]:
            page.set_viewport_size({'width': width, 'height': 844})
            visit('/library', listing=True)
            expect(page.locator('.library-intro')).to_have_count(0)
            rect = page.locator('.result-group').first.bounding_box()
            assert rect['y'] < 500, f'First video below first screen: {rect}'
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), f'Horizontal overflow at {width}'
            metrics.append({'viewport': width, 'first_result_top': round(rect['y'], 1)})
        page.set_viewport_size({'width': 1440, 'height': 900})
        return metrics
    run('Home first screen and responsive layout', 'P1', home_layout)

    def reader_layout():
        metrics = []
        for width in [320, 390, 900, 901, 1440, 2048]:
            page.set_viewport_size({'width': width, 'height': 900})
            for edition in [single, multi]:
                visit('/read/' + edition, reader=True)
                rect = page.locator('.reader-prose').bounding_box()
                assert rect['width'] >= min(width - 32, 500), f'Body too narrow: {rect}'
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
                metrics.append({'viewport': width, 'edition': edition, 'body_width': rect['width']})
        page.set_viewport_size({'width': 1440, 'height': 900})
        return metrics
    run('Single and multi-part reader widths', 'P1', reader_layout)

    def published_empty():
        visit('/library?view=published', listing=True)
        assert page.locator('.empty-state a').count() > 0, 'Empty published range has no direct preview link'
    run('Empty published range offers public previews', 'P2', published_empty)

    def browse_more():
        visit('/library', listing=True)
        expect(page.locator('.result-group')).to_have_count(32)
        page.get_by_role('button', name='再显示 32 个视频', exact=True).click()
        expect(page.locator('.result-group')).to_have_count(64)
        return {'initial': 32, 'after': 64}
    run('Library pagination', 'P2', browse_more)

    def search_case():
        counts = {}
        for query in ['CPU', 'cpu']:
            visit('/search?q=' + query, listing=True)
            counts[query] = page.locator('.result-total').inner_text()
        assert counts['CPU'] == counts['cpu'], f'Case changes results: {counts}'
        return counts
    run('Search treats ASCII case consistently', 'P1', search_case)

    def search_cost():
        visit('/search?q=CPU', listing=True, fresh=True)
        assets = page.evaluate("performance.getEntriesByType('resource').filter(x=>x.name.includes('search-')).map(x=>({url:x.name,bytes:x.decodedBodySize}))")
        assert not any('search-drafts-' in asset['url'] and asset['bytes'] > 10_000_000 for asset in assets), f'First query downloads full library: {assets}'
        return assets
    run('First query uses bounded search assets', 'P1', search_cost)

    def search_failure_retry():
        failed = [False]
        def fail_once(route):
            if not failed[0]:
                failed[0] = True
                route.fulfill(status=503, body='unavailable')
            else:
                route.continue_()
        page.route('**/search-candidates-drafts*.json', fail_once)
        try:
            visit('/search?q=CPU')
            expect(page.locator('.inline-error')).to_be_visible()
            page.get_by_role('button', name='重新查找').click()
            expect(page.locator('.result-group').first).to_be_visible(timeout=30000)
            return {'failed_request_seen': failed[0], 'retry_results': page.locator('.result-group').count()}
        finally:
            page.unroute('**/search-candidates-drafts*.json', fail_once)
    run('Search transport failure and retry', 'P1', search_failure_retry)

    def malformed_search():
        def malformed(route):
            route.fulfill(status=200, content_type='application/json', body='[]')
        page.route('**/search-candidates-drafts*.json', malformed)
        try:
            visit('/search?q=CPU')
            expect(page.locator('.loading-state')).to_have_count(0, timeout=30000)
            expect(page.locator('.inline-error')).to_be_visible()
        finally:
            page.unroute('**/search-candidates-drafts*.json', malformed)
    run('Malformed search assets produce an error', 'P2', malformed_search)

    def search_race():
        settled = []
        def on_settled(request):
            if '/search-candidates-drafts' in request.url:
                settled.append(request.failure or 'finished')
        page.on('requestfinished', on_settled)
        page.on('requestfailed', on_settled)
        def delay(route):
            time.sleep(1.5)
            route.continue_()
        page.route('**/search-candidates-drafts*.json', delay)
        try:
            visit('/search?q=CPU')
            expect(page.locator('.loading-state')).to_be_visible()
            page.evaluate("location.hash='#/recent'")
            expect(page.locator('.recent-page')).to_be_visible()
            # Wait for completion or cancellation, including the entire asset,
            # so checking recent does not race against a large response body.
            deadline = time.monotonic() + 45
            while not settled and time.monotonic() < deadline:
                page.wait_for_timeout(50)
            assert settled, 'Delayed search request did not settle within 45 seconds'
            page.wait_for_timeout(100)
            assert page.locator('.recent-page').count() == 1, f'Late response replaced recent page while URL is {page.url}'
            assert page.locator('.search-page').count() == 0, f'Late response rendered search page while URL is {page.url}'
        finally:
            page.unroute('**/search-candidates-drafts*.json', delay)
            page.remove_listener('requestfinished', on_settled)
            page.remove_listener('requestfailed', on_settled)
    run('Navigation rejects a late search response', 'P1', search_race)

    def query_markup():
        query = '<img src=x onerror=alert(1)>'
        visit('/search?q=' + quote(query), listing=True)
        assert page.locator('.results-heading img').count() == 0
        return {'escaped_query': page.locator('.results-heading h2').inner_text()}
    run('Search query HTML is displayed as text', 'P1', query_markup)

    def continuous():
        visit('/read/' + multi + '?flow=continuous', reader=True)
        first_text = page.locator('.reader-prose').inner_text()
        button = page.locator('[data-action="load-next"]')
        button.scroll_into_view_if_needed()
        before = page.evaluate('scrollY')
        button.click()
        expect(page.locator('.reader-article')).to_have_count(2)
        assert page.locator('.reader-prose').first.inner_text() == first_text, 'Appending replaced the first body'
        assert page.evaluate('scrollY') > before, 'Continue did not enter the appended part'
        ids = page.locator('[id]').evaluate_all('nodes=>nodes.map(n=>n.id)')
        assert len(ids) == len(set(ids)), 'Continuous flow duplicates DOM IDs'
        second = page.locator('.reader-article').nth(1)
        expect(page).to_have_url(__import__('re').compile('/read/' + second.get_attribute('data-edition-id')))
        expect(page.locator('.reader-identity strong')).to_contain_text('P2')
        second.scroll_into_view_if_needed()
        expect(page).to_have_url(__import__('re').compile('/read/' + second.get_attribute('data-edition-id')))
        page.locator('.reader-article').first.scroll_into_view_if_needed()
        expect(page).to_have_url(__import__('re').compile('/read/' + multi))
        return {'articles': 2, 'first_body_retained': True, 'unique_ids': True, 'flow_url_tracks_visible_part': True}
    run('Continuous reading appends real next part and tracks position', 'P1', continuous)

    def view_switch():
        visit('/read/' + single, reader=True)
        assert page.locator(f'a[href*="/verify/{single}"]').count() > 0, 'Reader has no link to its verification document'
    run('Body has an exact-version verification entry', 'P1', view_switch)

    def source_facts():
        visit('/read/' + single, reader=True)
        expect(page.locator('.reader-status')).to_contain_text('未发布')
        page.get_by_role('button', name='更多', exact=True).click()
        page.get_by_role('button', name='来源与版本', exact=True).click()
        facts = page.locator('.tool-drawer').inner_text()
        source_url = page.locator('.source-facts a').first.get_attribute('href')
        digest = page.locator('.source-version-details').last.locator('dt').filter(has_text='正文文件 SHA-256').locator('xpath=following-sibling::dd[1]').inner_text()
        assert single in facts and '正文文件 SHA-256' in facts and '原视频' in facts, facts
        assert source_url and source_url.startswith('http'), f'Invalid source URL: {source_url}'
        assert len(digest) == 64 and all(character in '0123456789abcdef' for character in digest.lower()), f'Invalid SHA-256 value: {digest}'
        frozen = next(entry for entry in catalog['articles'] if entry['editionId'] == single)
        assert digest == frozen['artifactSha256'], 'Visible body hash differs from frozen snapshot'
        assert source_url == frozen['sourceUrl'], 'Visible source differs from frozen snapshot'
        assert frozen['aiRevisionId'] in facts and frozen['contentSha256'] in facts and frozen['reviewArtifactSha256'] in facts
        return {'edition': single, 'draft_status_visible': True, 'source_url': source_url, 'frozen_version_values_equal': True}
    run('Source, edition and SHA-256 are visibly represented', 'P1', source_facts)

    def feedback():
        visit('/verify/' + single, reader=True)
        page.get_by_role('button', name='更多', exact=True).click()
        page.locator('[data-tool="feedback"]').click()
        expect(page.locator('[data-feedback-form]')).to_be_visible()
        for name, value in {'quote': '核验测试原句', 'context': '核验上下文', 'suggestion': '建议替换句', 'reason': '核验理由'}.items():
            page.locator('[data-feedback-form] [name="' + name + '"]').fill(value)
        page.get_by_role('button', name='整理建议', exact=True).click()
        output = page.locator('[data-feedback-output]')
        expect(output).to_contain_text(single)
        expect(output).to_contain_text('核验测试原句')
        expect(output).to_contain_text('校验参照')
        url = page.locator('[data-feedback-issue]').get_attribute('href')
        assert 'issues/new' in url and 'body=' in url, 'Version-linked prefilled feedback missing'
        return {'version': single, 'review_mode': True, 'prefilled_issue': True}
    run('Verification prepares correction feedback with exact version', 'P1', feedback)

    def tools_restore():
        visit('/read/' + single, reader=True)
        page.evaluate('window.scrollTo({top:1400,behavior:"instant"})')
        before = page.evaluate('scrollY')
        page.get_by_role('button', name='更多', exact=True).click()
        expect(page.locator('.tool-drawer')).to_be_visible()
        after = page.evaluate('scrollY')
        page.locator('.drawer-close').click()
        expect(page.locator('.tool-drawer')).to_have_count(0)
        closed = page.evaluate('scrollY')
        assert abs(closed - before) < 5, f'Tool destroys reader position: before={before}, open={after}, closed={closed}'
    run('Opening and closing tools preserves prose position', 'P1', tools_restore)

    def verify_history():
        visit('/verify/' + single, reader=True, fresh=True)
        records = page.evaluate(f'JSON.parse(localStorage.getItem("{history_key}")||"[]")')
        assert len(records) == 0, f'Verification creates body reading history: {records}'
    run('Verification does not write body progress', 'P1', verify_history)

    def stale_recent():
        value = [{'editionId': '0'*32, 'title': 'withdrawn sample', 'anchor': 'passage-7', 'readAt': 1791696000000}]
        visit('/recent')
        page.evaluate('([key,value])=>localStorage.setItem(key,JSON.stringify(value))', [history_key, value])
        visit('/recent', fresh=True)
        expect(page.locator('.recent-page')).to_be_visible()
        assert 'withdrawn sample' in page.locator('.recent-page').inner_text(), 'Unavailable reading record silently disappears from management'
    run('Unavailable history is visible and manageable', 'P1', stale_recent)

    def corrupt_storage():
        visit('/recent')
        page.evaluate('key=>localStorage.setItem(key,"[null]")', history_key)
        before = len(errors)
        visit('/recent', fresh=True)
        expect(page.locator('.recent-page')).to_be_visible()
        assert len(errors) == before, f'Corrupt record causes runtime error: {errors[before:]}'
    run('Malformed saved history remains usable', 'P1', corrupt_storage)

    def return_search():
        visit('/search?q=CPU&view=drafts', listing=True)
        page.locator('.result-group h2 a').first.click()
        expect(page.locator('.reader-prose')).to_be_visible()
        page.locator('.reader-back').click()
        expect(page.locator('.primary-search')).to_be_visible()
        assert 'q=CPU' in page.url and 'view=drafts' in page.url, f'Search return context lost: {page.url}'
    run('Reader return restores search context', 'P1', return_search)

    def keyboard_drawer():
        visit('/read/' + multi, reader=True)
        page.get_by_role('button', name='更多', exact=True).focus()
        page.keyboard.press('Enter')
        expect(page.locator('.tool-drawer')).to_be_visible()
        focus = page.evaluate('document.activeElement.tagName')
        page.keyboard.press('Escape')
        assert page.locator('.tool-drawer').count() == 0, f'Escape leaves drawer open; focus={focus}'
    run('Keyboard opens and dismisses tool drawer', 'P2', keyboard_drawer)

    def titles():
        visit('/read/' + single, reader=True)
        assert '哲学入门' in page.title(), f'Reader title is generic: {page.title()}'
    run('Browser title identifies current article', 'P2', titles)

    def bad_route():
        visit('/read/' + single + '?block=passage-1&block=passage-7')
        expect(page.locator('.reader-prose, .empty-state').first).to_be_visible()
        assert page.locator('.reader-prose').count() == 0, 'Ambiguous duplicate block route is accepted'
    run('Duplicate route parameters are rejected', 'P2', bad_route)

    def settings():
        visit('/read/' + single, reader=True)
        page.get_by_role('button', name='更多', exact=True).click()
        expect(page.locator('.tool-drawer')).to_be_visible()
        page.locator('[data-tool="settings"]').click()
        page.locator('[data-preference="size"]').select_option('21')
        page.locator('[data-preference="width"]').select_option('920')
        visit('/read/' + single, reader=True, fresh=True)
        css = page.locator('.reader-prose').evaluate('e=>({size:getComputedStyle(e).fontSize,width:e.getBoundingClientRect().width})')
        assert css['size'] == '21px' and css['width'] == 920, f'Settings not retained: {css}'
        return css
    run('Reading size and width survive reload', 'P2', settings)

    def dark_contrast():
        visit('/library', listing=True)
        page.get_by_role('button', name='切换深浅主题').click()
        colors = page.locator('.search-field button').evaluate('e=>({foreground:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})')
        def luminance(color):
            values = [float(channel) / 255 for channel in color[color.index('(') + 1:color.index(')')].split(',')[:3]]
            values = [channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4 for channel in values]
            return sum(channel * weight for channel, weight in zip(values, [0.2126, 0.7152, 0.0722]))
        light, dark = sorted([luminance(colors['foreground']), luminance(colors['background'])], reverse=True)
        ratio = (light + 0.05) / (dark + 0.05)
        assert ratio >= 4.5, f'Normal button text contrast is {ratio:.2f}:1; colors={colors}'
        return {'ratio': round(ratio, 2), **colors}
    run('Dark search button text has sufficient contrast', 'P2', dark_contrast)

    def document_failure():
        def failure(route):
            route.fulfill(status=503, body='unavailable')
        page.route('**/body-*.md', failure)
        try:
            visit('/read/' + single)
            expect(page.locator('.empty-state')).to_be_visible()
            assert page.get_by_role('button', name='重新加载').count() > 0, 'Transport failure is rendered as missing document without retry'
        finally:
            page.unroute('**/body-*.md', failure)
    run('Body transport failure offers retry', 'P2', document_failure)

    def body_resume():
        visit('/read/' + single, reader=True)
        page.evaluate('window.scrollTo({top:1450,behavior:"instant"})')
        page.wait_for_timeout(350)
        before = page.evaluate(position_script)
        visit('/recent')
        page.locator('.recent-actions a').first.click()
        expect(page.locator('.reader-prose')).to_be_visible()
        after_recent = page.evaluate(position_script)
        assert_position(before, after_recent, 'Recent loses canonical paragraph')
        page.reload()
        expect(page.locator('.reader-prose')).to_be_visible()
        after_reload = page.evaluate(position_script)
        assert_position(before, after_reload, 'Reload loses canonical paragraph')
        return {'before': before, 'recent': after_recent, 'reload': after_reload}
    run('Recent and reload restore exact body paragraph offset', 'P1', body_resume)

    def verify_return():
        visit('/read/' + single, reader=True)
        page.evaluate('window.scrollTo({top:1500,behavior:"instant"})')
        before = page.evaluate('scrollY')
        page.locator('[data-tool="more"]').click()
        page.locator('.tool-drawer a').filter(has_text='打开核验参照').click()
        expect(page.locator('.review-note')).to_be_visible()
        page.evaluate('window.scrollTo({top:900,behavior:"instant"})')
        page.locator('[data-tool="more"]').click()
        page.locator('.tool-drawer a').filter(has_text='返回正文').click()
        expect(page.locator('.review-note')).to_have_count(0)
        assert abs(page.evaluate('scrollY') - before) < 5, f'Verification changed body location {before} -> {page.evaluate("scrollY")}'
    run('Verification returns to body without changing body position', 'P1', verify_return)

    def next_failure():
        visit('/read/' + multi + '?flow=continuous', reader=True)
        first = page.locator('.reader-prose').inner_text()
        def unavailable(route):
            route.fulfill(status=503, body='temporary')
        page.route('**/body-*.md', unavailable)
        button = page.locator('[data-action="load-next"]')
        button.scroll_into_view_if_needed()
        before = page.evaluate('scrollY')
        button.click()
        expect(page.locator('.reader-end [role="alert"]')).to_be_visible()
        assert page.locator('.reader-prose').inner_text() == first
        assert abs(page.evaluate('scrollY') - before) < 5
        page.unroute('**/body-*.md', unavailable)
        button.click()
        expect(page.locator('.reader-article')).to_have_count(2)
    run('Next-part failure preserves body and supports retry', 'P1', next_failure)

    def navigation_refresh():
        visit('/library', listing=True)
        page.locator('[data-action="load-more"]').click()
        expect(page.locator('.result-group')).to_have_count(64)
        page.locator('.more-parts').first.locator('summary').click()
        page.evaluate('window.scrollTo({top:400,behavior:"instant"})')
        before = page.evaluate('scrollY')
        # Dispatch the link without Playwright first scrolling an off-screen
        # heading; this check owns the exact saved list position.
        page.locator('.result-group h2 a').first.evaluate('e=>e.click()')
        expect(page.locator('.reader-prose')).to_be_visible()
        page.reload()
        expect(page.locator('.reader-prose')).to_be_visible()
        page.locator('.reader-back').click()
        expect(page.locator('.result-group')).to_have_count(64)
        assert page.locator('.more-parts').first.get_attribute('open') is not None
        assert abs(page.evaluate('scrollY') - before) < 5, f'List location {before} -> {page.evaluate("scrollY")}'
    run('Reader reload preserves list limit disclosure and return scroll', 'P1', navigation_refresh)

    def storage_denied():
        page.add_init_script("Storage.prototype.setItem = function(){ throw new DOMException('denied','SecurityError'); }")
        visit('/read/' + single, reader=True)
        expect(page.locator('[data-storage-notice]')).to_be_visible()
        page.locator('[data-tool="more"]').click()
        page.locator('[data-tool="settings"]').click()
        page.locator('[data-preference="size"]').select_option('21')
        expect(page.locator('.reader-prose')).to_have_css('font-size', '21px')
    run('Denied storage is visible and does not block reading settings', 'P1', storage_denied)

    def stale_identity():
        visit('/read/' + single, reader=True)
        visit('/recent')
        expect(page.locator('.recent-page')).to_be_visible()
        page.evaluate('key=>{let items=JSON.parse(localStorage.getItem(key));items[0].artifactSha256="0".repeat(64);localStorage.setItem(key,JSON.stringify(items));}', history_key)
        visit('/recent', fresh=True)
        expect(page.locator('.recent-unavailable')).to_be_visible()
        assert page.locator('.recent-actions a').inner_text().startswith('从当前版本开始')
        page.locator('[data-remove-history]').click()
        expect(page.locator('.recent-unavailable')).to_have_count(0)
    run('Changed body version remains visible but cannot restore stale position', 'P1', stale_identity)

    def feedback_draft():
        visit('/read/' + single, reader=True)
        page.locator('[data-tool="more"]').click()
        page.locator('[data-tool="feedback"]').click()
        page.locator('[name="quote"]').fill('仅正文草稿')
        page.reload()
        expect(page.locator('.reader-prose')).to_be_visible()
        page.locator('[data-tool="more"]').click()
        page.locator('[data-tool="feedback"]').click()
        expect(page.locator('[name="quote"]')).to_have_value('仅正文草稿')
        page.locator('.drawer-close').click()
        page.locator('.reader-view-links a').first.click()
        expect(page.locator('.review-note')).to_be_visible()
        page.locator('[data-tool="more"]').click()
        page.locator('[data-tool="feedback"]').click()
        expect(page.locator('[name="quote"]')).to_have_value('')
    run('Feedback draft survives reload and stays separate from verification', 'P1', feedback_draft)

    def keyboard_focus():
        page.set_viewport_size({'width': 900, 'height': 900})
        visit('/read/' + multi, reader=True)
        opener = page.locator('[data-tool="more"]')
        opener.focus(); page.keyboard.press('Enter')
        expect(page.locator('.tool-drawer')).to_be_visible()
        assert page.locator('.tool-drawer').evaluate('e=>e.contains(document.activeElement)')
        for _ in range(12):
            page.keyboard.press('Tab')
            assert page.locator('.tool-drawer').evaluate('e=>e.contains(document.activeElement)')
        page.keyboard.press('Escape')
        expect(opener).to_be_focused()
    run('Drawer traps tab focus and restores the opener', 'P2', keyboard_focus)

    def feedback_copy_location():
        visit('/read/' + single, reader=True)
        page.evaluate('window.scrollTo({top:1400,behavior:"instant"}); Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:async text=>{window.copiedFeedback=text}}})')
        page.get_by_role('button', name='更多', exact=True).click()
        page.locator('[data-tool="feedback"]').click()
        for name, value in {'quote': '当前段落', 'suggestion': '修订建议', 'reason': '修改理由'}.items():
            page.locator('[data-feedback-form] [name="' + name + '"]').fill(value)
        page.get_by_role('button', name='整理建议', exact=True).click()
        expect(page.locator('[data-feedback-output]')).to_contain_text('当前段落')
        text = page.locator('[data-feedback-output]').input_value()
        assert 'block=' in text, 'Feedback omitted the current canonical paragraph location'
        page.locator('[data-action="copy-feedback"]').click()
        expect(page.locator('[data-feedback-status]')).to_contain_text('已复制')
        assert page.evaluate('window.copiedFeedback') == text, 'Copied feedback differs from visible paragraph-linked text'
    run('Feedback preview and clipboard preserve the same exact paragraph link', 'P1', feedback_copy_location)

    def docked_tools():
        measurements = []
        for mode, edition in [('read', single), ('read', multi), ('verify', multi)]:
            for width in [1100, 1366, 1440, 1600, 2048]:
                page.set_viewport_size({'width': width, 'height': 900})
                visit('/' + mode + '/' + edition, reader=True, fresh=True)
                page.evaluate('window.scrollTo({top:1400,behavior:"instant"})')
                before = page.evaluate(position_script)
                page.locator('[data-tool="more"]').click()
                page.locator('[data-tool="feedback"]').click()
                expect(page.locator('[data-feedback-form]')).to_be_visible()
                expect(page.locator('.tool-drawer')).to_have_attribute('aria-busy', 'false')
                expect(page.locator('.tool-drawer')).to_have_attribute('aria-modal', 'false')
                prose = page.locator('.reader-prose').bounding_box()
                drawer = page.locator('.tool-drawer').bounding_box()
                assert prose['x'] + prose['width'] <= drawer['x'] - 16, f'Prose covered at {width}: {prose}, {drawer}'
                assert prose['width'] >= 600, f'Docked manuscript too narrow at {width}: {prose}'
                assert page.locator('.reader-layout').evaluate('e=>!e.inert'), 'Docked reader cannot be selected or used'
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'Overflow at {width}'
                if mode == 'verify' and width == 2048:
                    page.screenshot(path=str(output / 'verification-feedback-docked.png'))
                page.keyboard.press('Escape')
                expect(page.locator('.tool-drawer')).to_have_count(0)
                page.wait_for_function('''before => {
                    const a=[...document.querySelectorAll('.reader-article')].find(e=>e.getBoundingClientRect().bottom>90);
                    const p=a?.querySelector('.reader-prose');
                    const blocks=[...p?.querySelectorAll('[data-block-id]')||[]].filter(e=>e.checkVisibility());
                    const b=p?.getBoundingClientRect().top<=90 ? blocks.find(e=>e.getBoundingClientRect().bottom>90)||blocks.at(-1) : null;
                    const r=b?.getBoundingClientRect(), offset=r?(90-r.top)/Math.max(1,r.height):0;
                    return a?.dataset.editionId===before.edition && (b?.dataset.blockId||'')===before.anchor && Math.abs(offset-before.offset)<.04;
                }''', arg=before)
                closed = page.evaluate(position_script)
                assert_position(before, closed, f'Docked close loses canonical position at {mode}/{edition}/{width}')
                measurements.append({'mode': mode, 'width': width, 'prose_width': round(prose['width'], 2), 'gap': round(drawer['x'] - prose['x'] - prose['width'], 2), 'anchor': closed['anchor']})
        return measurements
    run('Docked feedback reserves space beside single multi and verification manuscripts', 'P1', docked_tools)

    def responsive_tools():
        visit('/read/' + multi, reader=True)
        page.locator('[data-tool="more"]').click()
        for width in [2048, 1099, 900, 390, 320, 1440]:
            page.set_viewport_size({'width': width, 'height': 900})
            modal = width < 1100
            expect(page.locator('.tool-drawer')).to_have_attribute('aria-modal', str(modal).lower())
            expect(page.locator('.reader-layout')).to_have_css('visibility', 'hidden' if modal else 'visible')
            assert page.locator('.reader-layout').evaluate('e=>e.inert') == modal
            if modal:
                box = page.locator('.tool-drawer').bounding_box()
                assert box['x'] == 0 and abs(box['width'] - width) < 1
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.keyboard.press('Escape')
        expect(page.locator('.reader-layout')).to_be_visible()
        assert page.locator('.reader-layout').evaluate('e=>!e.inert')
    run('Open tools adapt between usable dock and isolated full-width small-screen view', 'P1', responsive_tools)

    def docked_feedback_identity():
        visit('/read/' + multi + '?flow=continuous', reader=True)
        page.locator('[data-action="load-next"]').click()
        expect(page.locator('.reader-article')).to_have_count(2)
        second = page.locator('.reader-article').nth(1).get_attribute('data-edition-id')
        page.locator('.reader-article').first.scroll_into_view_if_needed()
        expect(page).to_have_url(__import__('re').compile('/read/' + multi))
        page.locator('[data-tool="more"]').click()
        page.locator('[data-tool="feedback"]').click()
        expect(page.locator('[data-feedback-form]')).to_have_attribute('data-edition-id', multi)
        expect(page.locator('.tool-drawer')).to_have_attribute('aria-busy', 'false')
        page.locator('[name="quote"]').fill('P1 feedback stays P1')
        page.evaluate('document.querySelectorAll(".reader-article")[1].scrollIntoView()')
        expect(page).to_have_url(__import__('re').compile('/read/' + second))
        page.locator('[name="suggestion"]').fill('P1 suggestion')
        page.locator('[name="reason"]').fill('P1 reason')
        page.get_by_role('button', name='整理建议', exact=True).click()
        expect(page.locator('[data-feedback-output]')).to_contain_text('P1 feedback stays P1')
        text = page.locator('[data-feedback-output]').input_value()
        assert multi in text and second not in text, 'Scrolling docked background changes feedback identity'
        expect(page.locator('[data-feedback-form]')).to_have_attribute('data-edition-id', multi)
    run('Docked feedback remains bound to its original version while continuous body scrolls', 'P1', docked_feedback_identity)

    report = {'base': base, 'browser': browser.version, 'checks': checks, 'summary': {
        'pass': sum(row['status'] == 'pass' for row in checks), 'fail': sum(row['status'] == 'fail' for row in checks)}}
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    browser.close()
print(json.dumps(report['summary']), flush=True)
raise SystemExit(1 if report['summary']['fail'] else 0)
