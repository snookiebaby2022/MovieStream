/**
 * Embed source manager — returns playable iframe URLs for TMDB IDs.
 * Providers are ordered cleanest-first. Health checks are soft: many hosts
 * block server-side fetches but still work in the browser iframe.
 */

class S {
  constructor(name, base) {
    this.name = name;
    this.baseUrl = base;
  }
  ua() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  buildUrl() { return ''; }
  async getSource(id, type, s, e) {
    const url = this.buildUrl(id, type, s, e);
    if (!url) return null;
    // Always return URL — browser iframe is the real availability test
    return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
  }
}

class VidLinkPro extends S {
  constructor() { super('vidlink', 'https://vidlink.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}?primaryColor=e50914&autoplay=true&title=false&poster=false`
      : `${this.baseUrl}/movie/${id}?primaryColor=e50914&autoplay=true&title=false&poster=false`;
  }
}

class VidSrcMe extends S {
  constructor() { super('vidsrc', 'https://vidsrc.me'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
      : `${this.baseUrl}/embed/movie?tmdb=${id}`;
  }
}

class VidSrcIn extends S {
  constructor() { super('vidsrc.in', 'https://vidsrc.in'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcCC extends S {
  constructor() { super('vidsrc.cc', 'https://vidsrc.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/v2/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/v2/embed/movie/${id}`;
  }
}

class VidSrcICU extends S {
  constructor() { super('vidsrc.icu', 'https://vidsrc.icu'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcNL extends S {
  constructor() { super('vidsrc.nl', 'https://player.vidsrc.nl'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcXyz extends S {
  constructor() { super('vidsrc.xyz', 'https://vidsrc.xyz'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv?tmdb=${id}&season=${s}&episode=${e}`
      : `${this.baseUrl}/embed/movie?tmdb=${id}`;
  }
}

class VidSrcPro extends S {
  constructor() { super('vidsrc.pro', 'https://vidsrc.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class TwoEmbed extends S {
  constructor() { super('2embed', 'https://www.2embed.cc'); }
  buildUrl(id, t, s, e) {
    // Fixed: query string must start with ?
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embedtv/${id}?s=${s}&e=${e}`
      : `${this.baseUrl}/embed/${id}`;
  }
}

class TwoEmbedOrg extends S {
  constructor() { super('2embed.org', 'https://www.2embed.org'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class MultiEmbed extends S {
  constructor() { super('multiembed', 'https://multiembed.mov'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/?video_id=${id}&tmdb=1&s=${s}&e=${e}`
      : `${this.baseUrl}/?video_id=${id}&tmdb=1`;
  }
}

class AutoEmbed extends S {
  constructor() { super('autoembed', 'https://player.autoembed.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class EmbedSu extends S {
  constructor() { super('embed.su', 'https://embed.su'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class MoviesApi extends S {
  constructor() { super('moviesapi', 'https://moviesapi.club'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}-${s}-${e}`
      : `${this.baseUrl}/movie/${id}`;
  }
}

class SmashyStream extends S {
  constructor() { super('smashy', 'https://player.smashy.stream'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}?s=${s}&e=${e}`
      : `${this.baseUrl}/movie/${id}`;
  }
}

class VidFast extends S {
  constructor() { super('vidfast', 'https://vidfast.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}?autoPlay=true`
      : `${this.baseUrl}/movie/${id}?autoPlay=true`;
  }
}

class NontonGo extends S {
  constructor() { super('nontongo', 'https://www.nontongo.win'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class SuperEmbed extends S {
  constructor() { super('superembed', 'https://multiembed.mov'); }
  buildUrl(id, t, s, e) {
    const q = t === 'tv' && s && e
      ? `video_id=${id}&tmdb=1&s=${s}&e=${e}`
      : `video_id=${id}&tmdb=1`;
    return `https://multiembed.mov/directstream.php?${q}`;
  }
}

class ScraperManager {
  constructor() {
    // Cleanest / most reliable first
    this.scrapers = [
      { instance: new VidLinkPro(),   priority: 1,  enabled: true },
      { instance: new VidSrcMe(),     priority: 2,  enabled: true },
      { instance: new VidSrcIn(),     priority: 3,  enabled: true },
      { instance: new VidSrcCC(),     priority: 4,  enabled: true },
      { instance: new VidSrcPro(),    priority: 5,  enabled: true },
      { instance: new VidSrcNL(),     priority: 6,  enabled: true },
      { instance: new VidSrcXyz(),    priority: 7,  enabled: true },
      { instance: new VidSrcICU(),    priority: 8,  enabled: true },
      { instance: new VidFast(),      priority: 9,  enabled: true },
      { instance: new AutoEmbed(),    priority: 10, enabled: true },
      { instance: new EmbedSu(),      priority: 11, enabled: true },
      { instance: new TwoEmbed(),     priority: 12, enabled: true },
      { instance: new TwoEmbedOrg(),  priority: 13, enabled: true },
      { instance: new MultiEmbed(),   priority: 14, enabled: true },
      { instance: new MoviesApi(),    priority: 15, enabled: true },
      { instance: new SmashyStream(), priority: 16, enabled: true },
      { instance: new SuperEmbed(),   priority: 17, enabled: true },
      { instance: new NontonGo(),     priority: 18, enabled: true },
    ];
    this.scrapers.sort((a, b) => a.priority - b.priority);
  }

  async getSources(tmdbId, type, season, episode) {
    const results = [];
    const errors = [];
    const enabled = this.scrapers.filter(s => s.enabled);
    console.log(`Scraping ${enabled.length} sources for ${type}:${tmdbId}`);

    await Promise.allSettled(enabled.map(async scraper => {
      const t = Date.now();
      try {
        const source = await Promise.race([
          scraper.instance.getSource(tmdbId, type, season, episode),
          new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 5000))
        ]);
        if (source && source.embedUrl) {
          results.push({ ...source, priority: scraper.priority, elapsed: Date.now() - t });
          console.log(`  OK ${scraper.instance.name} (${Date.now() - t}ms)`);
        } else {
          console.log(`  -- ${scraper.instance.name}`);
        }
      } catch (e) {
        console.log(`  XX ${scraper.instance.name}: ${e.message}`);
        errors.push({ source: scraper.instance.name, error: e.message });
      }
    }));

    results.sort((a, b) => a.priority - b.priority);
    console.log(`  Found ${results.length}/${enabled.length}`);
    return { sources: results, errors };
  }

  getScraperStatus() {
    return this.scrapers.map(s => ({
      name: s.instance.name,
      baseUrl: s.instance.baseUrl,
      priority: s.priority,
      enabled: s.enabled
    }));
  }

  setEnabled(name, enabled) {
    const s = this.scrapers.find(x => x.instance.name === name);
    if (s) s.enabled = !!enabled;
    return !!s;
  }
}

module.exports = ScraperManager;
