/* 公开只读静态适配层：把 API 请求映射到 data/mobile.json 与按需趋势文件。
 * 与本机 API 同一信封：{ ok: true, data } / { ok: false, error }。 */
(() => {
  const CACHE_KEY = 'like-monitor:snapshot:v5';
  let loading = null;
  let snapshot = null;

  async function readJson(url) {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`读取数据失败（HTTP ${response.status}）`);
    return response.json();
  }

  async function load() {
    if (loading) return loading;
    try { snapshot = normalize(JSON.parse(localStorage.getItem(CACHE_KEY))); } catch { snapshot = null; }
    loading = (async () => {
      try {
        snapshot = normalize(await readJson(window.LIKE_DATA_URL));
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* quota */ }
      } catch (error) {
        if (!snapshot) throw error;
      }
      return snapshot;
    })();
    return loading;
  }

  /* 兼容 schema 1 旧快照（state/rankings）：映射为 schema 2 键名（overview/compare）。
   * schema 2 原样返回；两代嵌套负载结构一致，仅顶层键名与信封残留不同。 */
  function normalize(raw) {
    const data = raw && typeof raw === 'object' ? raw : {};
    if (!data.overview && data.state) {
      const { ok: _drop, ...rest } = data.state;
      data.overview = rest;
    }
    if (!data.compare && data.rankings) {
      const compare = {};
      for (const [hours, payload] of Object.entries(data.rankings)) {
        const { ok: _drop, ...rest } = payload || {};
        compare[hours] = rest;
      }
      data.compare = compare;
    }
    return data;
  }

  const ok = (data) => ({ ok: true, data });
  const fail = (message) => ({ ok: false, error: message });
  const readonly = () => fail('公开只读版不支持此操作，请在电脑端使用本机控制台');

  const csvCell = (value) => {
    const text = String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };

  function exportCsv(data, accountId) {
    const rows = [['账号', 'sec_uid', '粉丝数', '粉丝采集时间', '视频ID', '标题', '发布时间', '点赞', '评论', '分享', '收藏', '采集时间', '视频链接']];
    const accounts = accountId == null
      ? (data.overview?.accounts || [])
      : (data.overview?.accounts || []).filter((account) => String(account.id) === String(accountId));
    const publishedAt = (timestamp) => (timestamp
      ? new Date((Number(timestamp) + 8 * 3600) * 1000).toISOString().slice(0, 19)
      : '');
    return (async () => {
      const accountVideos = await Promise.all(accounts.map((account) => loadAccountVideos(account)));
      accounts.forEach((account, index) => {
        const followers = account.followers?.latest || {};
        for (const video of accountVideos[index].videos) {
          const latest = video.latest || {};
          rows.push([
            account.nickname, account.sec_uid, followers.follower_count, followers.collected_at,
            video.aweme_id, video.title, publishedAt(video.create_time), latest.digg_count,
            latest.comment_count, latest.share_count, latest.collect_count, latest.collected_at,
            video.share_url,
          ]);
        }
      });
      return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    })();
  }

  async function loadAccountVideos(account) {
    const fallback = account.all_videos || account.videos || [];
    try {
      const payload = await readJson(`${baseDir()}mobile-videos/${account.id}.json`);
      return {
        account: payload.account || { id: account.id, nickname: account.nickname || '', sec_uid: account.sec_uid || '' },
        videos: payload.videos || [],
        total: Number(payload.total ?? (payload.videos || []).length),
      };
    } catch {
      return {
        account: { id: account.id, nickname: account.nickname || '', sec_uid: account.sec_uid || '' },
        videos: fallback,
        total: fallback.length,
      };
    }
  }

  function recentSnapshots(payload, hours) {
    const snapshots = payload.snapshots || [];
    if (!hours || snapshots.length < 2) return payload;
    const latest = Math.max(...snapshots.map((entry) => Date.parse(entry.collected_at) || 0));
    const end = Date.parse(payload.generated_at) || latest;
    const cutoff = end - hours * 3600000;
    return {
      ...payload,
      snapshots: snapshots.filter((entry) => (Date.parse(entry.collected_at) || 0) >= cutoff),
      downsampled: false,
    };
  }

  function baseDir() {
    return window.LIKE_DATA_URL.replace(/mobile\.json$/, '');
  }

  async function request(path, options = {}) {
    const url = new URL(path, location.href);
    const method = (options.method || 'GET').toUpperCase();
    const data = await load();
    if (method !== 'GET') return readonly();

    if (url.pathname === '/api/overview') return ok(data.overview || {});
    if (url.pathname === '/api/insights') {
      const hours = url.searchParams.get('hours') || '24';
      return data.insights?.[hours] ? ok(data.insights[hours]) : fail('该窗口暂无数据');
    }
    if (url.pathname === '/api/compare') {
      const hours = url.searchParams.get('hours') || '24';
      return data.compare?.[hours] ? ok(data.compare[hours]) : fail('该窗口暂无数据');
    }
    if (url.pathname === '/api/highlights') return ok(data.highlights || {});
    if (url.pathname === '/api/reports') {
      return ok(data.reports?.[url.searchParams.get('period') || 'daily'] || data.reports?.daily || {});
    }
    if (url.pathname === '/api/system') {
      return ok({ now: data.generated_at, readonly: true, profile_fallback: false });
    }
    if (url.pathname === '/api/jobs/status') {
      return ok({ collector: data.overview?.collector || { running: false }, runs: [] });
    }
    if (url.pathname === '/api/export.csv') {
      return ok({ csv: await exportCsv(data, url.searchParams.get('account_id')) });
    }

    const followers = url.pathname.match(/^\/api\/accounts\/(\d+)\/followers$/);
    if (followers) {
      const payload = await readJson(`${baseDir()}mobile-followers/${followers[1]}.json`);
      return ok(recentSnapshots(payload, Number(url.searchParams.get('hours') || 0)));
    }
    const accountVideos = url.pathname.match(/^\/api\/accounts\/(\d+)\/videos$/);
    if (accountVideos) {
      const account = (data.overview?.accounts || [])
        .find((item) => String(item.id) === String(accountVideos[1]));
      if (!account) return fail('账号不存在');
      return ok(await loadAccountVideos(account));
    }
    const snapshots = url.pathname.match(/^\/api\/videos\/([^/]+)\/snapshots$/);
    if (snapshots) {
      const payload = await readJson(`${baseDir()}mobile-snapshots/${encodeURIComponent(snapshots[1])}.json`);
      return ok(recentSnapshots(payload, Number(url.searchParams.get('hours') || 0)));
    }
    return fail('公开只读版不支持此接口');
  }

  window.LikeStaticApi = Object.freeze({ request, refresh: load });
  document.documentElement.dataset.readonly = 'true';
})();
