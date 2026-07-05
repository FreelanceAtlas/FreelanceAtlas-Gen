// DataForSEO API client — keyword research and metrics.
// Uses Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD env vars).
// All calls hit the "live" endpoints (synchronous, no task polling needed).

const DFS_BASE = "https://api.dataforseo.com/v3";

// Default to US English. Pass a different locationCode/languageCode per call to override.
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
  volume: number | null;          // avg monthly search volume
  difficulty: number | null;      // 0-100 keyword difficulty
  cpc: number | null;             // avg CPC in USD
  competition: number | null;     // 0-1 competition score
  trend: MonthlySearch[];         // last 12 months of monthly search volume
  search_intent: string | null;   // informational | navigational | commercial | transactional
}

// --- Keyword Ideas (DataForSEO Labs) ------------------------------------
// Returns keyword ideas for a seed keyword with full metrics.
//
// Response shape: tasks[0].result[0].items[] — each item has:
//   keyword_info.search_volume, keyword_info.cpc, etc. (direct, not nested under keyword_data)
//   keyword_properties.keyword_difficulty

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
    includeAdult?: boolean;
  } = {}
): Promise<KeywordMetrics[]> {
  const {
    locationCode = DEFAULT_LOCATION_CODE,
    languageCode = DEFAULT_LANGUAGE_CODE,
    limit = 50,
    includeAdult = false,
  } = options;

  const response = await dfsPost<DfsKeywordIdeasResponse>(
    "/dataforseo_labs/google/keyword_ideas/live",
    [
      {
        keyword: seed,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        include_adult_keywords: includeAdult,
        include_serp_info: false,
      },
    ]
  );

  const task = response.tasks?.[0];
  if (!task || task.status_code !== 20000) return [];

  // Results are wrapped: result[0].items is the keyword array
  const items = task.result?.[0]?.items;
  if (!items) return [];

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

// --- Keyword Search Volume (Google Ads data) ---------------------------
// Returns volume + CPC + competition for a list of known keywords.

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

  // DataForSEO Google Ads endpoint accepts up to 700 keywords per task.
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
    if (!task || task.status_code !== 20000 || !task.result) continue;

    // search_volume/live returns result[] directly (one item per keyword)
    for (const item of task.result) {
      if (!item.keyword) continue;
      results.push({
        keyword: item.keyword,
        volume: item.search_volume ?? null,
        difficulty: null, // Google Ads endpoint doesn't return difficulty
        cpc: item.cpc ?? null,
        competition: item.competition ?? null,
        trend: item.monthly_searches ?? [],
        search_intent: null,
      });
    }
  }

  return results;
}

// --- Related Keywords (DataForSEO Labs) --------------------------------
// Returns keywords semantically related to the seed.
//
// Response shape: tasks[0].result[0].items[] — each item has:
//   keyword_data.keyword_info (nested, unlike keyword_ideas)
//   keyword_properties.keyword_difficulty

interface DfsRelatedKeywordsItem {
  keyword: string;
  keyword_data: {
    keyword_info: {
      search_volume: number | null;
      competition: number | null;
      cpc: number | null;
      monthly_searches: MonthlySearch[] | null;
      search_intent: { main_intent: string } | null;
    };
  };
  keyword_properties: {
    keyword_difficulty: number | null;
  };
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
        keyword: seed,
        location_code: locationCode,
        language_code: languageCode,
        limit,
        depth,
        include_seed_keyword: true,
      },
    ]
  );

  const task = response.tasks?.[0];
  if (!task || task.status_code !== 20000) return [];

  // Results are wrapped: result[0].items is the keyword array
  const items = task.result?.[0]?.items;
  if (!items) return [];

  return items
    .filter((item) => !!item.keyword)
    .map((item) => ({
      keyword: item.keyword,
      volume: item.keyword_data?.keyword_info?.search_volume ?? null,
      difficulty: item.keyword_properties?.keyword_difficulty ?? null,
      cpc: item.keyword_data?.keyword_info?.cpc ?? null,
      competition: item.keyword_data?.keyword_info?.competition ?? null,
      trend: item.keyword_data?.keyword_info?.monthly_searches ?? [],
      search_intent: item.keyword_data?.keyword_info?.search_intent?.main_intent ?? null,
    }));
}
