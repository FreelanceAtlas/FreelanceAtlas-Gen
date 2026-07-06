// Thumbnail generation pipeline for article featured images.
//
//   1. sceneForTitle()  — an LLM art-director turns a blog title into a minimal
//      scene description (Stage 1).
//   2. renderThumbnail() — Gemini renders that scene as a wide landscape flat-
//      vector image in the locked FreelanceAtlas style.
//   3. editThumbnail()   — feeds the LAST generated image plus a change note back
//      to Gemini to revise it (the "redo with notes" flow).
//   4. uploadThumbnailToWp() — pushes the PNG to the WordPress media library and
//      returns { mediaId, url } so it can become a post's featured image.
//
// All image work uses google/gemini-3-pro-image because it is the only model on
// OpenRouter that reliably returns a true 16:9 landscape (GPT image is locked to
// square). Scene text uses google/gemini-2.5-flash.

const OR = "https://openrouter.ai/api/v1/chat/completions";
const SITE = "https://freelanceatlas.com";

function key() {
  const k = process.env.OPENROUTER_API_KEY;
  if (!k) throw new Error("OPENROUTER_API_KEY is not set.");
  return k;
}
const SCENE_MODEL = () => process.env.OPENROUTER_SCENE_MODEL || "google/gemini-2.5-flash";
const IMAGE_MODEL = () => process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-3-pro-image";

const CHAR =
  "The character (when present) is always the SAME friendly freelancer: a young man in his late " +
  "twenties with short dark wavy hair and a light-medium skin tone, wearing a solid medium-blue " +
  "crewneck sweater, drawn in simple flat-vector style.";

const STYLE = `

STYLE: Modern flat vector illustration, clean and friendly, smooth rounded shapes, soft subtle shadows, thin dashed connector lines as light accents. Editorial blog-thumbnail quality.

COLOR PALETTE: Predominantly blues - deep navy (#1E3A5F), medium blue (#3B82C4), soft sky blue (#8FB8E8), teal accent (#2CA6A4). Small pops of amber-yellow and green (checkmarks, success). Clean white / very-light-blue (#F7FAFF) background. No dark or photographic backgrounds.

LAYOUT: generous white space, minimal and uncluttered. Render the header as bold text across the top in a rounded geometric sans-serif (Poppins-style): deep navy, spelled EXACTLY and correctly. Keep the illustration in the lower two-thirds. One clear focal subject plus at most two supporting props. Always include a small mug reading "FreelanceAtlas.com" tucked in a lower corner.

SAFE MARGINS (critical): keep a generous empty padding margin of at least 10 percent on ALL FOUR edges. Every element must sit fully INSIDE this safe area. Nothing may touch, overlap, or bleed off any edge. Scale down slightly if needed so nothing is clipped.

AVOID: photorealism, 3D render, heavy gradients, busy backgrounds, cluttered composition, tiny unreadable text, watermarks, stock-photo look.

HEADER TEXT (render exactly at the top): "%HEADER%"`;

const LEAD =
  "Create a WIDE 16:9 LANDSCAPE blog thumbnail (horizontal, much wider than tall, NOT square). " +
  "Leave a generous safe margin around all four edges so no element is cut off.\n\n";

export interface Scene {
  has_person: boolean;
  header: string;
  scene: string;
}

async function orJson(body: unknown, timeoutMs = 90000): Promise<any> {
  const res = await fetch(OR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      "HTTP-Referer": SITE,
      "X-Title": "FreelanceAtlas-Gen",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

// Stage 1: title -> minimal scene description.
export async function sceneForTitle(title: string): Promise<Scene> {
  const prompt = `You are the art director for FreelanceAtlas, a freelancing advice blog. Turn this blog title into a scene for a minimal flat-vector thumbnail.

BLOG TITLE: "${title}"

Rules:
- Choose ONE concrete visual metaphor for the title. Minimal: one focal subject + at most two supporting props.
- has_person: true only if a person clearly helps; otherwise prefer a clean object-only composition.
- header: a short punchy version of the title for the top of the image, max 8 words, Title Case, spelled correctly.
- scene: one paragraph describing objects/props/short labels and their horizontal layout. Do NOT mention colors, style, or the title text. If has_person is false, begin the scene with "NO PEOPLE.".

Return ONLY valid JSON: {"has_person": bool, "header": "...", "scene": "..."}`;

  const d = await orJson({
    model: SCENE_MODEL(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });
  let txt: string = d?.choices?.[0]?.message?.content ?? "";
  txt = txt.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const o = JSON.parse(txt);
    return { has_person: !!o.has_person, header: String(o.header || title).slice(0, 80), scene: String(o.scene || "") };
  } catch {
    return { has_person: false, header: title.slice(0, 80), scene: `NO PEOPLE. A clean minimal object-only composition representing: ${title}.` };
  }
}

function extractImage(d: any): string {
  const imgs = d?.choices?.[0]?.message?.images || [];
  if (!imgs.length) throw new Error("Image model returned no image.");
  const url: string = imgs[0]?.image_url?.url || "";
  const b64 = url.startsWith("data:") ? url.split(",", 2)[1] : "";
  if (!b64) throw new Error("Image had no base64 data.");
  return b64; // base64 PNG
}

// Stage 2: scene -> rendered PNG (returns base64).
export async function renderThumbnail(scene: Scene): Promise<string> {
  const prompt =
    LEAD + scene.scene + (scene.has_person ? "\n\n" + CHAR : "") + STYLE.replace("%HEADER%", scene.header);
  const d = await orJson(
    { model: IMAGE_MODEL(), messages: [{ role: "user", content: prompt }], modalities: ["image", "text"] },
    280000
  );
  return extractImage(d);
}

// Redo: previous PNG + change note -> revised PNG (returns base64).
export async function editThumbnail(prevPngBase64: string, changeNote: string, header: string): Promise<string> {
  const instruction =
    `Revise this existing FreelanceAtlas blog thumbnail based on the change note, while keeping the same ` +
    `flat-vector style, blue palette, wide 16:9 landscape format, generous safe margins on all edges, and the ` +
    `header text "${header}" spelled exactly. Change note: ${changeNote}`;
  const d = await orJson(
    {
      model: IMAGE_MODEL(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: instruction },
            { type: "image_url", image_url: { url: `data:image/png;base64,${prevPngBase64}` } },
          ],
        },
      ],
      modalities: ["image", "text"],
    },
    280000
  );
  return extractImage(d);
}

// Upload a base64 PNG to the WP media library. Returns the media id + URL.
export async function uploadThumbnailToWp(
  pngBase64: string,
  slug: string,
  altText: string
): Promise<{ mediaId: number; url: string }> {
  const base = process.env.WORDPRESS_API_URL || SITE;
  const user = process.env.WORDPRESS_USERNAME;
  const appPassword = process.env.WORDPRESS_APP_PASSWORD;
  if (!user || !appPassword) throw new Error("WordPress credentials missing.");
  const auth = Buffer.from(`${user}:${appPassword}`).toString("base64");
  const bytes = Buffer.from(pngBase64, "base64");

  const up = await fetch(`${base.replace(/\/$/, "")}/wp-json/wp/v2/media`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "image/png",
      "Content-Disposition": `attachment; filename="${slug}.png"`,
    },
    body: bytes,
  });
  if (!up.ok) throw new Error(`WP media upload failed (${up.status}): ${(await up.text()).slice(0, 300)}`);
  const media = await up.json();
  const mediaId = media.id as number;

  // Best-effort alt text / title for SEO.
  await fetch(`${base.replace(/\/$/, "")}/wp-json/wp/v2/media/${mediaId}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ alt_text: altText, title: altText }),
  }).catch(() => {});

  return { mediaId, url: media.source_url || `${base}/?attachment_id=${mediaId}` };
}

// Download a WP media URL back to base64 (used to feed the last thumbnail into a redo).
export async function fetchImageAsBase64(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Could not fetch previous thumbnail (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}
