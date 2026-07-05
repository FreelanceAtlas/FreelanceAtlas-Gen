// DataForSEO API client — keyword research and metrics.
// Uses Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD env vars).
// All calls hit the "live" endpoints (synchronous, no task polling needed).

const DFS_BASE = "https://api.dataforseo.com/v3";

export const DEFAULT_LOCATION_CODE = 2840; // United States
export const DEFAULT_LANGUAGE_CODE = "en";

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error(
      "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set in environment variables."
    );
  }
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}

async function dfsPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader(),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DataForSEO ${path} failed (${res.status}): ${text}`);
  }
  const data = await res.json();
  if (data.status_code !== 20000) {
    throw new Error(
      `DataForSEO error ${data.status_code}: ${data.status_message ?? "unknown error"}`
    );
  }
  return data as T;
}

// --- Shared types -------------------------------------------------------

export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

export interface KeywordMetrics {
  keyword: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: MonthlySearch[];
  search_intent: string | null;
}

// --- Keyword Ideas (DataForSEO Labs) ------------------------------------
// Endpoint: /dataforseo_labs/google/keyword_ideas/live
// Request field: `keywords` (array of strings) — NOT the singular `keyword`

interface DfsKeywordIdeasItem {
  keyword: string;
  keyword_info: {
    search_volume: number | null;
    competition: number | null;
    competition_level: string | null;
    cpc: number | null;
    monthly_searches: MonthlySearch[] | null;
    search_intent: { main_intent: string } | null;
  };
  keyword_properties: {
    keyword_difficulty: number | null;
  };
}

interface DfsKeywordIdeasResponse {
  status_code: number;
  status_message: string;
  tasks: {
    status_code: number;
    status_message: string;
    result: {
      keyword: string;
      items_count: number;
      items: DfsKeywordIdeasItem[] | null;
    }[] | null;
  }[];
}

export async function getKeywordIdeas(
  seed: string,
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number;
  } = {}
): Promise<KeywordMetrics[]> {
  const {
    locationCode = DEFAULT_LOCATION_CODE,
    languageCode = DEFAULT_LANGUAGE_CODE,
    limit = 50,
  } = options;

  const response = await dfsPost<DfsKeywordIdeasResponse>(
    "/dataforseo_labs/google/keyword_ideas/live",
    [
      {
        keywords: [seed],          // array, not singular string
        location_code: locationCode,
        language_code: languageCode,
        limit,
        include_serp_info: false,
      },
    ]
  );

  const task = response.tasks?.[0];
  if (!task) {
    console.error(`[dataforseo] keyword_ideas "${seed}": no task in response`);
    return [];
  }
  if (task.status_code !== 20000) {
    console.error(
      `[dataforseo] keyword_ideas "${seed}": task status ${task.status_code} — ${task.status_message}`
    );
    return [];
  }

  const items = task.result?.[0]?.items;
  if (!items || items.length === 0) {
    console.warn(`[dataforseo] keyword_ideas "${seed}": task OK but items empty/null`);
    return [];
  }

  return items
    .filter((item) => !!item.keyword)
    .map((item) => ({
      keyword: item.keyword,
      volume: item.keyword_info?.search_volume ?? null,
      difficulty: item.keyword_properties?.keyword_difficulty ?? null,
      cpc: item.keyword_info?.cpc ?? null,
      competition: item.keyword_info?.competition ?? null,
      trend: item.keyword_info?.monthly_searches ?? [],
      search_intent: item.keyword_info?.search_intent?.main_intent ?? null,
    }));
}

// --- Keyword Search Volume (Google Ads data) ----------------------------

interface DfsSearchVolumeResponse {
  status_code: number;
  status_message: string;
  tasks: {
    status_code: number;
    status_message: string;
    result: {
      keyword: string;
      search_volume: number | null;
      competition: number | null;
      competition_level: string | null;
      cpc: number | null;
      monthly_searches: MonthlySearch[] | null;
    }[] | null;
  }[];
}

export async function getKeywordMetrics(
  keywords: string[],
  options: {
    locationCode?: number;
    languageCode?: string;
  } = {}
): Promise<KeywordMetrics[]> {
  if (keywords.length === 0) return [];

  const {
    locationCode = DEFAULT_LOCATION_CODE,
    languageCode = DEFAULT_LANGUAGE_CODE,
  } = options;

  const BATCH = 700;
  const results: KeywordMetrics[] = [];

  for (let i = 0; i < keywords.length; i += BATCH) {
    const batch = keywords.slice(i, i + BATCH);
    const response = await dfsPost<DfsSearchVolumeResponse>(
      "/keywords_data/google_ads/search_volume/live",
      [
        {
          keywords: batch,
          location_code: locationCode,
          language_code: languageCode,
        },
      ]
    );

    const task = response.tasks?.[0];
    if (!task || task.status_code !== 20000 || !task.result) {
      console.error(
        `[dataforseo] search_volume batch: task status ${
          task?.status_code
        } — ${task?.status_message}`
      );
      continue;
    }

    for (const item of task.result) {
      if (!item.keyword) continue;
      results.push({
        keyword: item.keyword,
        volume: item.search_volume ?? null,
        difficulty: null,
        cpc: item.cpc ?? null,
        competition: item.competition ?? null,
        trend: item.monthly_searches ?? [],
        search_intent: null,
      });
    }
  }

  return results;
}

// --- Related Keywords (DataForSEO Labs) ---------------------------------
//
// IMPORTANT: response nests everything under keyword_data:
//   item.keyword_data.keyword
//   item.keyword_data.keyword_info.*
//   item.keyword_data.keyword_properties.*

interface DfsRelatedKeywordsItem {
  keyword_data: {
    keyword: string;
    keyword_info: {
      search_volume: number | null;
      competition: number | null;
      cpc: number | null;
      monthly_searches: MonthlySearch[] | null;
      search_intent_info?: { main_intent: string } | null;
      search_intent?: { main_intent: string } | null;
    };
    keyword_properties: {
      keyword_difficulty: number | null;
    };
  };
  depth: number;
  related_keywords: string[] | null;
}

interface DfsRelatedKeywordsResponse {
  status_code: number;
  status_message: string;
  tasks: {
    status_code: number;
    status_message: string;
    result: {
      keyword: string;
      items_count: number;
      items: DfsRelatedKeywordsItem[] | null;
    }[] | null;
  }[];
}

export async function getRelatedKeywords(
  seed: string,
  options: {
    locationCode?: number;
    languageCode?: string;
    limit?: number;
    depth?: number;
  } = {}
): Promise<KeywordMetrics[]> {
  const {
    locationCode = DEFAULT_LOCATION_CODE,
    languageCode = DEFAULT_LANGUAGE_CODE,
    limit = 50,
    depth = 1,
  } = options;

  const response = await dfsPost<DfsRelatedKeywordsResponse>(
    "/dataforseo_labs/google/related_keywords/live",
    [
      {
        keyword: seed,             // related_keywords uses singular `keyword`
        location_code: locationCode,
        language_code: languageCode,
        limit,
        depth,
        include_seed_keyword: true,
      },
    ]
  );

  const task = response.tasks?.[0];
  if (!task) {
    console.error(`[dataforseo] related_keywords "${seed}": no task in response`);
    return [];
  }
  if (task.status_code !== 20000) {
    console.error(
      `[dataforseo] related_keywords "${seed}": task status ${task.status_code} — ${task.status_message}`
    );
    return [];
  }

  const items = task.result?.[0]?.items;
  if (!items || items.length === 0) {
    console.warn(`[dataforseo] related_keywords "${seed}": task OK but items empty/null`);
    return [];
  }

  return items
    .filter((item) => !!item.keyword_data?.keyword)
    .map((item) => {
      const kd = item.keyword_data;
      const ki = kd.keyword_info;
      return {
        keyword: kd.keyword,
        volume: ki?.search_volume ?? null,
        difficulty: kd.keyword_properties?.keyword_difficulty ?? null,
        cpc: ki?.cpc ?? null,
        competition: ki?.competition ?? null,
        trend: ki?.monthly_searches ?? [],
        search_intent:
          ki?.search_intent_info?.main_intent ??
          ki?.search_intent?.main_intent ??
          null,
      };
    });
}
