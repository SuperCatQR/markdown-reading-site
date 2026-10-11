"""Independent feedback module audit; no source changes or external submission."""
import argparse
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--base", default="http://127.0.0.1:5180/")
parser.add_argument("--out", default="artifacts/feedback-acceptance")
args = parser.parse_args()
base = args.base.rstrip("/") + "/"
output = Path(args.out)
output.mkdir(parents=True, exist_ok=True)
edition = "0724ad88f2f34abea2924007462b7f7b"
results = []


def open_feedback(page, mode="read"):
    page.goto(base + f"#/{mode}/{edition}?block=passage-7")
    expect(page.locator(".reader-prose")).to_be_visible()
    page.get_by_role("button", name="更多", exact=True).click()
    page.locator('[data-tool="feedback"]').click()
    expect(page.locator('[data-feedback-form]')).to_be_visible()


def complete_draft(page):
    for field, value in {"quote": "exact original <tag>&", "context": "surrounding sentence", "suggestion": "correct wording", "reason": "source evidence"}.items():
        page.locator(f'[data-feedback-form] [name="{field}"]').fill(value)
    expect(page.locator('[data-action="copy-feedback"]')).to_be_enabled()


def arrange(page):
    page.get_by_role("button", name="整理建议", exact=True).click()
    expect(page.locator('[data-feedback-output]')).not_to_have_value("")
    # Live editing already updates the textarea before submission. Wait for
    # the newly activated Issue link to distinguish the asynchronous render.
    expect(page.locator('[data-feedback-issue]')).to_be_visible()


def selection_capture(page):
    page.goto(base + f"#/read/{edition}?block=passage-7")
    expect(page.locator('.reader-prose [data-block-id="passage-7"]')).to_be_visible()
    selected = page.evaluate("""() => {
      const block = document.querySelector('.reader-prose [data-block-id="passage-7"]');
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode()) && !node.textContent.trim()) {}
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(18, node.textContent.length));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      block.dispatchEvent(new PointerEvent('pointerup', {bubbles: true}));
      return {quote: selection.toString().trim(), context: block.textContent.trim()};
    }""")
    assert selected['quote'], "No source text selected"
    page.get_by_role("button", name="更多", exact=True).click()
    page.locator('[data-tool="feedback"]').click()
    expect(page.locator('[data-action="feedback-selection"]')).to_be_visible()
    page.locator('[data-action="feedback-selection"]').click()
    expect(page.locator('[name="quote"]')).to_have_value(selected['quote'])
    expect(page.locator('[name="context"]')).to_have_value(selected['context'])
    expect(page.locator('[data-feedback-location]')).to_have_attribute('href', base + f'#/read/{edition}?block=passage-7')
    return {'quote': selected['quote'], 'context_length': len(selected['context']), 'exact_location': True}


def live_validation(page):
    open_feedback(page)
    copy = page.locator('[data-action="copy-feedback"]')
    expect(copy).to_be_disabled()
    expect(page.locator('[data-feedback-count="quote"]')).to_have_text('0 / 4000 字符')
    complete_draft(page)
    expect(page.locator('[data-feedback-count="quote"]')).to_have_text('21 / 4000 字符')
    page.locator('[name="reason"]').fill(' \n ')
    expect(copy).to_be_disabled()
    expect(page.locator('[name="reason"]')).to_have_attribute('aria-invalid', 'true')
    expect(page.locator('[data-feedback-validation]')).to_contain_text('理由')
    page.locator('[name="reason"]').fill('verified reason')
    expect(copy).to_be_enabled()
    return {'empty_disabled': True, 'blank_reason_disabled': True, 'counts_live': True}


def stale_issue_and_copy_failure(page):
    open_feedback(page, mode='verify')
    complete_draft(page)
    arrange(page)
    issue = page.locator('[data-feedback-issue]')
    text = page.locator('[data-feedback-output]').input_value()
    expect(issue).to_be_visible()
    old_href = issue.get_attribute('href')
    assert parse_qs(urlparse(old_href).query)['body'][0] == text
    page.locator('[name="suggestion"]').fill('new edited wording')
    expect(issue).to_be_hidden()
    assert issue.get_attribute('href') is None, 'Stale Issue href remains active'
    # The output is a textarea: its rendered textContent stays empty while
    # the user-visible value updates through the input binding.
    expect(page.locator('[data-feedback-output]')).to_have_value(re.compile('new edited wording'))
    arrange(page)
    new_href = page.locator('[data-feedback-issue]').get_attribute('href')
    assert new_href != old_href
    text = page.locator('[data-feedback-output]').input_value()
    assert parse_qs(urlparse(new_href).query)['body'][0] == text
    page.evaluate("Object.defineProperty(navigator, 'clipboard', {configurable:true,value:{writeText:()=>Promise.reject(new Error('blocked'))}})")
    page.locator('[data-action="copy-feedback"]').click()
    expect(page.locator('[data-feedback-status]')).to_contain_text('复制失败')
    expect(page.locator('[data-feedback-output]')).to_have_value(text)
    return {'stale_href_removed': True, 'issue_body_equals_visible_output': True, 'manual_copy_keeps_text_after_failure': True}


def overlimit_no_truncation(page):
    open_feedback(page)
    complete_draft(page)
    too_long = '长' * 4001
    page.locator('[name="context"]').evaluate("(node, value) => {node.value=value;node.dispatchEvent(new InputEvent('input',{bubbles:true}))}", too_long)
    expect(page.locator('[name="context"]')).to_have_value(too_long)
    expect(page.locator('[data-feedback-count="context"]')).to_have_text('4001 / 4000 字符')
    expect(page.locator('[data-action="copy-feedback"]')).to_be_disabled()
    expect(page.locator('[data-feedback-status]')).to_contain_text('原输入仍保留')
    # Submit through the app boundary to test recovered/programmatic drafts that
    # native maxlength does not itself truncate.
    page.locator('[data-feedback-form]').evaluate("node => node.dispatchEvent(new Event('submit', {bubbles:true,cancelable:true}))")
    expect(page.locator('[name="context"]')).to_have_value(too_long)
    expect(page.locator('[data-action="copy-feedback"]')).to_be_disabled()
    assert page.locator('[data-feedback-issue]').count() == 0
    allowed = '长' * 4000
    page.locator('[name="context"]').fill(allowed)
    arrange(page)
    text = page.locator('[data-feedback-output]').input_value()
    assert allowed in text, 'Valid long context truncated from output'
    href = page.locator('[data-feedback-issue]').get_attribute('href')
    assert 'body=' not in href, 'Long suggestion unexpectedly put into oversized Issue URL'
    return {'overlimit_length_preserved': 4001, 'valid_full_context_preserved': 4000, 'long_link_manual_fallback': True}


def delayed_clipboard_edit(page):
    evidence = []
    for valid_after_edit in [True, False]:
        open_feedback(page)
        complete_draft(page)
        page.evaluate("""() => {
            window.__feedbackPendingText = '';
            window.__resolveFeedbackCopy = null;
            Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
                writeText(text) {
                    window.__feedbackPendingText = text;
                    return new Promise(resolve => { window.__resolveFeedbackCopy = resolve; });
                }
            }});
        }""")
        page.locator('[data-action="copy-feedback"]').click()
        page.wait_for_function('Boolean(window.__resolveFeedbackCopy)')
        assert 'correct wording' in page.evaluate('window.__feedbackPendingText')
        page.locator('[name="suggestion"]').fill('edited while copying')
        if not valid_after_edit:
            page.locator('[name="reason"]').fill('   ')
        # Resolve the old operation after the live draft has changed. Flush
        # actual rendered frames without inserting an artificial copy delay.
        page.evaluate("""async () => {
            window.__resolveFeedbackCopy();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }""")
        expect(page.locator('[data-feedback-status]')).not_to_contain_text('已复制')
        expect(page.locator('[name="suggestion"]')).to_have_value('edited while copying')
        if valid_after_edit:
            expect(page.locator('[data-feedback-output]')).to_have_value(re.compile('edited while copying'))
            expect(page.locator('[data-action="copy-feedback"]')).to_be_enabled()
        else:
            expect(page.locator('[data-feedback-output]')).to_have_value('')
            expect(page.locator('[data-action="copy-feedback"]')).to_be_disabled()
            expect(page.locator('[name="reason"]')).to_have_attribute('aria-invalid', 'true')
        evidence.append({'valid_after_edit': valid_after_edit, 'old_copy_status_suppressed': True, 'current_draft_retained': True})
    return evidence


def responsive_and_sticky_close(page):
    evidence = []
    for width in [320, 390, 1440]:
        page.set_viewport_size({'width': width, 'height': 844})
        open_feedback(page)
        complete_draft(page)
        arrange(page)
        for theme in ['light', 'dark']:
            current = page.locator('html').get_attribute('data-refactor-theme')
            if current != theme:
                page.locator('[data-action="close-tool"]').click()
                page.locator('[data-action="theme"]').click()
                page.get_by_role('button', name='更多', exact=True).click()
                page.locator('[data-tool="feedback"]').click()
                expect(page.locator('[data-feedback-form]')).to_be_visible()
            width_result = page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
            assert width_result['scroll'] == width, f'Page overflow {width_result}'
            page.locator('.tool-drawer').evaluate('node => {node.scrollTop=node.scrollHeight}')
            close = page.locator('[data-action="close-tool"]')
            rect = close.bounding_box()
            assert rect and 64 <= rect['y'] < 844 - 44, f'Close scrolls offscreen at {width} {theme}: {rect}'
            assert rect['width'] >= 44 and rect['height'] >= 44
            expect(close).to_be_visible()
            evidence.append({'width': width, 'theme': theme, 'close_y': round(rect['y'], 2), 'scroll_width': width_result['scroll']})
        close.click()
        expect(page.locator('.tool-drawer')).to_have_count(0)
    return evidence


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for name, callback in [
        ('Selection capture fills exact quote, context and paragraph', selection_capture),
        ('Live counts and valid/invalid copy state', live_validation),
        ('Edited Issue href is inactive; copy failure keeps manual text', stale_issue_and_copy_failure),
        ('Oversized input remains intact and long valid output stays complete', overlimit_no_truncation),
        ('Delayed clipboard completion cannot claim an edited or invalid draft was copied', delayed_clipboard_edit),
        ('Mobile and dark layouts keep close usable after panel scroll', responsive_and_sticky_close),
    ]:
        context = browser.new_context(viewport={'width': 1440, 'height': 844}, reduced_motion='reduce')
        page = context.new_page()
        page.set_default_timeout(15000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        try:
            evidence = callback(page)
            assert not errors, f'Browser errors: {errors}'
            result = {'name': name, 'status': 'pass', 'evidence': evidence}
        except Exception as error:
            page.screenshot(path=str(output / f'{len(results)+1}-failure.png'))
            result = {'name': name, 'status': 'fail', 'error': str(error), 'page_errors': errors}
        results.append(result)
        print(json.dumps(result, ensure_ascii=True), flush=True)
        context.close()
    browser.close()

(output / 'report.json').write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
raise SystemExit(1 if any(result['status'] != 'pass' for result in results) else 0)
