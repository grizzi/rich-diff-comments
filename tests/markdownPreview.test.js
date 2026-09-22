const test = require('node:test');
const assert = require('node:assert/strict');

const { renderMarkdownPreview } = require('../src/lib/markdownPreview.js');

test('empty / whitespace input returns the empty placeholder', () => {
  assert.match(renderMarkdownPreview(''), /grdc-preview-empty/);
  assert.match(renderMarkdownPreview('   \n\n   '), /grdc-preview-empty/);
});

test('renders headings', () => {
  const html = renderMarkdownPreview('# Title\n\n## Sub');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<h2>Sub<\/h2>/);
});

test('bold and italic', () => {
  const html = renderMarkdownPreview('**bold** and _italic_ and ~~strike~~');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<del>strike<\/del>/);
});

test('inline code is not transformed', () => {
  const html = renderMarkdownPreview('use `**not bold**` here');
  assert.match(html, /<code>\*\*not bold\*\*<\/code>/);
  assert.doesNotMatch(html, /<strong>/);
});

test('fenced code block keeps content intact and adds language class', () => {
  const html = renderMarkdownPreview('```python\nprint("hi <b>")\n```');
  assert.match(html, /<pre><code class="language-python">/);
  // Content should be HTML-escaped, not rendered. Quotes escape to `&quot;`
  // too — they render identically inside <code>, and the same escaper feeds
  // double-quoted href/src attributes, where an unescaped quote breaks out.
  assert.match(html, /print\(&quot;hi &lt;b&gt;&quot;\)/);
});

test('links and images (image regex runs before link — bug fix)', () => {
  // Bug history: `![alt](pic.png)` used to produce `!alt` because the link
  // regex ran first and ate the link half of the image syntax.
  const html = renderMarkdownPreview('![logo](pic.png) and [docs](http://x)');
  assert.match(html, /<img alt="logo" src="pic\.png">/);
  assert.match(html, /<a href="http:\/\/x" target="_blank" rel="noopener noreferrer">docs<\/a>/);
  assert.doesNotMatch(html, /!\w/, 'no orphan ! left behind');
});

test('autolinks <http://...>', () => {
  const html = renderMarkdownPreview('see <http://example.com> for more');
  assert.match(html, /<a href="http:\/\/example\.com"/);
});

test('blockquote', () => {
  const html = renderMarkdownPreview('> quoted\n> line 2');
  assert.match(html, /<blockquote>quoted<br>line 2<\/blockquote>/);
});

test('bullet list', () => {
  const html = renderMarkdownPreview('- one\n- two\n- three');
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><li>three<\/li><\/ul>/);
});

test('numbered list', () => {
  const html = renderMarkdownPreview('1. one\n2. two');
  assert.match(html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test('paragraphs are wrapped, double-newline separated', () => {
  const html = renderMarkdownPreview('first para\n\nsecond para');
  assert.match(html, /<p>first para<\/p>/);
  assert.match(html, /<p>second para<\/p>/);
});

test('escapes raw HTML in source text', () => {
  const html = renderMarkdownPreview('a <script>x</script> tag');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('combined: heading + list + code', () => {
  const md = `# Plan

- step **one**
- step \`two\`

\`\`\`js
ok()
\`\`\``;
  const html = renderMarkdownPreview(md);
  assert.match(html, /<h1>Plan<\/h1>/);
  assert.match(html, /<li>step <strong>one<\/strong><\/li>/);
  assert.match(html, /<li>step <code>two<\/code><\/li>/);
  assert.match(html, /<pre><code class="language-js">ok\(\)<\/code><\/pre>/);
});

test('tables degrade gracefully (no crash, falls through as plain paragraph)', () => {
  // We don't claim to render tables. Just confirm we don't crash and the text
  // survives in some readable form (paragraph or escaped pipes).
  const md = `| a | b |\n|---|---|\n| 1 | 2 |`;
  let html;
  assert.doesNotThrow(() => { html = renderMarkdownPreview(md); });
  assert.ok(html.includes('a') && html.includes('b') && html.includes('1') && html.includes('2'),
    'cell text preserved somewhere in output');
});

test('XSS attempt inside fenced code is rendered as text, not as a tag', () => {
  const html = renderMarkdownPreview('```\n<script>alert(1)</script>\n```');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

// ---------------------------------------------------------------------------
// Attribute-injection regressions
//
// `escapeHtmlText` used to leave `"` alone while the image and link rules
// interpolated straight into double-quoted attributes, so a draft could close
// the attribute and add an event handler. Targets are also scheme-checked.
// ---------------------------------------------------------------------------

// Parse the output and inspect real attributes: the escaped text still
// *contains* the substring `onerror=`, but as inert characters inside a
// quoted value, so a raw string match would be the wrong assertion.
function attrNames(html) {
  const { JSDOM } = require('jsdom');
  const root = new JSDOM(`<div id="r">${html}</div>`).window.document.getElementById('r');
  return [...root.querySelectorAll('*')].flatMap((el) => [...el.attributes].map((a) => a.name));
}

test('image alt cannot break out of the alt attribute', () => {
  const html = renderMarkdownPreview('![x" onerror="alert(1)](y)');
  assert.ok(!attrNames(html).includes('onerror'), `unexpected handler in: ${html}`);
  assert.match(html, /&quot;/);
});

test('image src cannot break out of the src attribute', () => {
  const html = renderMarkdownPreview('![a](x" onerror="alert(1))');
  assert.ok(!attrNames(html).includes('onerror'), `unexpected handler in: ${html}`);
});

test('link href cannot break out of the href attribute', () => {
  const html = renderMarkdownPreview('[a](x" onmouseover="alert(1))');
  assert.ok(!attrNames(html).includes('onmouseover'), `unexpected handler in: ${html}`);
});

test('no draft text can introduce an event-handler attribute', () => {
  const drafts = [
    '![x" onerror="alert(1)](y)',
    '[a](x" onmouseover="alert(1))',
    '![a](x" onload="alert(1))',
    '# h" onclick="alert(1)',
    '**b" onfocus="alert(1)**',
  ];
  for (const d of drafts) {
    const handlers = attrNames(renderMarkdownPreview(d)).filter((n) => n.startsWith('on'));
    assert.deepEqual(handlers, [], `draft produced handlers ${handlers}: ${d}`);
  }
});

test('javascript: targets are neutralised', () => {
  assert.match(renderMarkdownPreview('[a](javascript:alert(1))'), /href="about:blank"/);
  assert.match(renderMarkdownPreview('![a](javascript:alert(1))'), /src="about:blank"/);
});

test('control characters cannot smuggle a blocked scheme', () => {
  assert.match(renderMarkdownPreview('[a](java\tscript:alert(1))'), /href="about:blank"/);
  assert.match(renderMarkdownPreview('[a](  JaVaScRiPt:alert(1))'), /href="about:blank"/);
});

test('safe and relative targets are left alone', () => {
  assert.match(renderMarkdownPreview('[a](https://example.com/x)'), /href="https:\/\/example\.com\/x"/);
  assert.match(renderMarkdownPreview('[a](../docs/README.md)'), /href="\.\.\/docs\/README\.md"/);
  assert.match(renderMarkdownPreview('[a](mailto:x@y.z)'), /href="mailto:x@y\.z"/);
});
