// WordPress publishing bridge.
//
// Two responsibilities:
//   1. formatArticleToDocHtml() — turns a stored article (markdown content_md +
//      faqs[]) into the exact `<div class="doc">…</div>` HTML the live
//      FreelanceAtlas theme expects, using an OpenRouter model for the
//      markdown->HTML + Key-Takeaways + FAQ-accordion transform.
//   2. createWordPressDraft() — POSTs that HTML to the WordPress REST API as a
//      DRAFT (never auto-published), authenticated with an Application Password,
//      and (when the companion mu-plugin is installed) fills the Yoast SEO
//      title + meta description.
//
// Nothing here ever publishes: status is always "draft" so a human approves the
// final post inside WP Admin.

import { stripDashes } from "./textClean";

export interface ArticleForWordPress {
  h1: string;
  title: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  content_md: string;
  faqs: { question: string; answer: string }[];
}

const SITE = "https://freelanceatlas.com";

// One published post, verbatim, used as a few-shot target so the model matches
// the live theme's markup byte-for-byte (wrapper, heading levels, the
// faqs-accordion structure, external-link rel/target attributes).
const TEMPLATE_EXAMPLE = `<div class="doc">
<p>Intro hook paragraph that restates the topic and answers it in a sentence or two.</p>
<p>At <a href="${SITE}/" target="_blank" rel="noopener noreferrer">FreelanceAtlas</a>, we help freelancers ... In this guide, we will walk through <strong>the main keyword</strong> and what it means.</p>
<h2>First Subhead as a Statement</h2>
<p>Body paragraph.</p>
<ul>
<li><strong>Bolded lead-in,</strong> then the explanation.</li>
</ul>
<h2>Conclusion</h2>
<p>Closing paragraph.</p>
<h2>Key Takeaways</h2><ul><li>Short takeaway one</li><li>Short takeaway two</li></ul>
<h2>Frequently Asked Questions</h2><div class="faqs-accordion"><div class="faqs-accordion__item"><details><summary class="faqs-accordion__title">A question?</summary><div class="faqs-accordion__body"><div class="faqs-accordion__inner"><div class="faqs-accordion__content"><p>The answer.</p></div></div></div></details></div></div>
</div>`;

function buildFormatPrompt(article: ArticleForWordPress): string {
  const faqBlock = article.faqs?.length
    ? article.faqs.map((f, i) => `${i + 1}. Q: ${f.question}\n   A: ${f.answer}`).join("\n")
    : "(none provided — derive 3-5 useful FAQs from the article body)";

  return `You are a precise HTML formatter for the FreelanceAtlas (${SITE}) WordPress blog.
Convert the article below into ONE block of HTML that exactly matches the live theme's
post structure. Output ONLY the HTML — no markdown fences, no commentary.

STRICT RULES
- Wrap everything in a single <div class="doc"> … </div>.
- Convert markdown to clean HTML: ## -> <h2>, ### -> <h3>, paragraphs -> <p>,
  bullet lists -> <ul><li>, **bold** -> <strong>, [text](url) -> <a>.
- Do NOT include the H1 anywhere in the body (WordPress renders the title separately).
- Every external link to a freelanceatlas.com URL, and every other outbound link,
  must be <a href="URL" target="_blank" rel="noopener noreferrer">…</a>.
- Only use URLs that already appear in the article markdown. Never invent or guess a URL.
- After the article's own conclusion, add: <h2>Key Takeaways</h2> followed by a <ul>
  of 4-6 concise <li> bullets summarizing the piece (no bold lead-ins here).
- Then add the FAQ section EXACTLY in this shape, one item per FAQ:
  <h2>Frequently Asked Questions</h2><div class="faqs-accordion"><div class="faqs-accordion__item"><details><summary class="faqs-accordion__title">QUESTION</summary><div class="faqs-accordion__body"><div class="faqs-accordion__inner"><div class="faqs-accordion__content"><p>ANSWER</p></div></div></div></details></div>…</div>
- Never use an em dash anywhere. Never use a spaced hyphen or double hyphen as a dash.
- Preserve the author's wording; only restructure into HTML. Do not rewrite sentences.

Here is the exact structure to match:
${TEMPLATE_EXAMPLE}

ARTICLE H1 (do not repeat in body): ${article.h1}

ARTICLE MARKDOWN:
${article.content_md}

FAQS:
${faqBlock}`;
}

// Calls OpenRouter to produce the final <div class="doc"> body HTML.
export async function formatArticleToDocHtml(article: ArticleForWordPress): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set — cannot format the article for WordPress.");

  const model = process.env.OPENROUTER_FORMAT_MODEL || "google/gemini-2.5-flash";

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SITE,
      "X-Title": "FreelanceAtlas-Gen",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: buildFormatPrompt(article) }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter formatting failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  let html: string = data?.choices?.[0]?.message?.content ?? "";
  if (!html.trim()) throw new Error("OpenRouter returned empty content while formatting the article.");

  // Defensively strip any stray code fences and the model's em-dashes.
  html = html.replace(/^```(?:html)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  html = stripDashes(html);

  if (!html.includes('class="doc"')) {
    html = `<div class="doc">\n${html}\n</div>`;
  }
  return html;
}

export interface WordPressDraftResult {
  id: number;
  editLink: string;
  link: string;
}

// Creates the post as a DRAFT via the WP REST API. Requires:
//   WORDPRESS_API_URL       e.g. https://freelanceatlas.com
//   WORDPRESS_USERNAME      the WP user the application password belongs to
//   WORDPRESS_APP_PASSWORD  the generated application password
// Optional:
//   WORDPRESS_DEFAULT_CATEGORY_ID  numeric category id for new drafts
export async function createWordPressDraft(
  article: ArticleForWordPress,
  bodyHtml: string,
  featuredMediaId?: number | null
): Promise<WordPressDraftResult> {
  const base = process.env.WORDPRESS_API_URL || SITE;
  const user = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;

  if (!user || !appPassword) {
    throw new Error(
      "WordPress credentials missing — set WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD."
    );
  }

  const auth = Buffer.from(`${user}:${appPassword}`).toString("base64");

  const payload: Record<string, unknown> = {
    title: stripDashes(article.title || article.h1),
    slug: article.slug,
    content: bodyHtml,
    status: "draft",
    // The companion mu-plugin (freelanceatlas-gen-yoast-rest.php) exposes these
    // Yoast meta keys to REST; without it WordPress simply ignores them.
    meta: {
      _yoast_wpseo_title: stripDashes(article.meta_title || article.title),
      _yoast_wpseo_metadesc: stripDashes(article.meta_description),
    },
  };

  const categoryId = process.env.WORDPRESS_DEFAULT_CATEGORY_ID;
  if (categoryId) payload.categories = [Number(categoryId)];

  // Attach the generated thumbnail as the post's featured image, if one exists.
  if (featuredMediaId) payload.featured_media = featuredMediaId;

  const res = await fetch(`${base.replace(/\/$/, "")}/wp-json/wp/v2/posts`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WordPress draft creation failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  const id = data?.id as number;
  return {
    id,
    link: data?.link ?? `${base}/?p=${id}`,
    editLink: `${base.replace(/\/$/, "")}/wp-admin/post.php?post=${id}&action=edit`,
  };
}

// Flips an existing WordPress post from draft to published (makes it live).
// Used by the "Publish live" control on articles already pushed as drafts.
export async function publishWordPressPost(postId: number): Promise<{ link: string }> {
  const base = process.env.WORDPRESS_API_URL || SITE;
  const user = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;

  if (!user || !appPassword) {
    throw new Error("WordPress credentials missing — set WORDPRESS_USERNAME and WORDPRESS_APP_PASSWORD.");
  }

  const auth = Buffer.from(`${user}:${appPassword}`).toString("base64");

  const res = await fetch(`${base.replace(/\/$/, "")}/wp-json/wp/v2/posts/${postId}`, {
    method: "POST", // WP REST accepts POST for updates
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ status: "publish" }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WordPress publish failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json();
  return { link: data?.link ?? `${base}/?p=${postId}` };
}
