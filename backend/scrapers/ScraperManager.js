const axios = require('axios');

class S {
  constructor(name, base) {
    this.name = name;
    this.baseUrl = base;
  }
  ua() {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  async check(url) {
    try {
      const r = await axios.get(url, {
        headers: { 'User-Agent': this.ua(), 'Referer': this.baseUrl },
        timeout: 8000, maxRedirects: 5, validateStatus: s => s < 500
      });
      return r.status === 200 && String(r.data || '').length > 200;
    } catch { return false; }
  }
  buildUrl() { return ''; }
  async getSource(id, type, s, e) {
    const url = this.buildUrl(id, type, s, e);
    if (!url) return null;
    const ok = await this.check(url);
    return ok ? { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url } : null;
  }
}

// ── CLEANEST SOURCES (fewest ads) ──────────────────────
class VidLinkPro extends S {
  constructor() { super('vidlink', 'https://vidlink.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/tv/' + id + '/' + s + '/' + e + '?primaryColor=e50914&autoplay=true&title=false'
      : this.baseUrl + '/movie/' + id + '?primaryColor=e50914&autoplay=true&title=false';
  }
}

class VidSrcIn extends S {
  constructor() { super('vidsrc.in', 'https://vidsrc.in'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class VidSrcCC extends S {
  constructor() { super('vidsrc.cc', 'https://vidsrc.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/v2/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/v2/embed/movie/' + id;
  }
}

class VidSrcICU extends S {
  constructor() { super('vidsrc.icu', 'https://vidsrc.icu'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class VidSrcNL extends S {
  constructor() { super('vidsrc.nl', 'https://player.vidsrc.nl'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class TwoEmbed extends S {
  constructor() { super('2embed', 'https://www.2embed.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embedtv/' + id + '&s=' + s + '&e=' + e
      : this.baseUrl + '/embed/' + id;
  }
}

class MultiEmbed extends S {
  constructor() { super('multiembed', 'https://multiembed.mov'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/?video_id=' + id + '&tmdb=1&s=' + s + '&e=' + e
      : this.baseUrl + '/?video_id=' + id + '&tmdb=1';
  }
}

class VidSrcXyz extends S {
  constructor() { super('vidsrc.xyz', 'https://vidsrc.xyz'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv?tmdb=' + id + '&season=' + s + '&episode=' + e
      : this.baseUrl + '/embed/movie?tmdb=' + id;
  }
}

class TwoEmbedOrg extends S {
  constructor() { super('2embed.org', 'https://2embed.org'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class AutoEmbed extends S {
  constructor() { super('autoembed', 'https://autoembed.co'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '-' + s + '-' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class NontonGo extends S {
  constructor() { super('nontongo', 'https://www.nontongo.win'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/tv/' + id + '/' + s + '/' + e
      : this.baseUrl + '/embed/movie/' + id;
  }
}

class CineEmbed extends S {
  constructor() { super('rgshows', 'https://www.rgshows.me'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? this.baseUrl + '/embed/api/2/tv?id=' + id + '&s=' + s + '&e=' + e
      : this.baseUrl + '/embed/api/2/movie?id=' + id;
  }
}

class ScraperManager {
  constructor() {
    // Ordered by ad-free/cleanest experience first
    this.scrapers = [
      { instance: new VidLinkPro(),   priority: 1,  enabled: true },
      { instance: new VidSrcIn(),     priority: 2,  enabled: true },
      { instance: new VidSrcCC(),     priority: 3,  enabled: true },
      { instance: new VidSrcICU(),    priority: 4,  enabled: true },
      { instance: new VidSrcNL(),     priority: 5,  enabled: true },
      { instance: new VidSrcXyz(),    priority: 6,  enabled: true },
      { instance: new TwoEmbed(),     priority: 7,  enabled: true },
      { instance: new TwoEmbedOrg(),  priority: 8,  enabled: true },
      { instance: new MultiEmbed(),   priority: 9,  enabled: true },
      { instance: new AutoEmbed(),    priority: 10, enabled: true },
      { instance: new NontonGo(),     priority: 11, enabled: true },
      { instance: new CineEmbed(),    priority: 12, enabled: true },
    ];
    this.scrapers.sort((a, b) => a.priority - b.priority);
  }

  async getSources(tmdbId, type, season, episode) {
    const results = [];
    const errors  = [];
    const enabled = this.scrapers.filter(s => s.enabled);
    console.log('Scraping ' + enabled.length + ' sources for ' + type + ':' + tmdbId);

    await Promise.allSettled(enabled.map(async scraper => {
      const t = Date.now();
      try {
        const source = await Promise.race([
          scraper.instance.getSource(tmdbId, type, season, episode),
          new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 10000))
        ]);
        if (source) {
          results.push({ ...source, priority: scraper.priority, elapsed: Date.now() - t });
          console.log('  OK ' + scraper.instance.name + ' (' + (Date.now() - t) + 'ms)');
        } else {
          console.log('  -- ' + scraper.instance.name);
        }
      } catch(e) {
        console.log('  XX ' + scraper.instance.name + ': ' + e.message);
        errors.push({ source: scraper.instance.name, error: e.message });
      }
    }));

    results.sort((a, b) => a.priority - b.priority);
    console.log('  Found ' + results.length + '/' + enabled.length);
    return { sources: results, errors };
  }

  getScraperStatus() {
    return this.scrapers.map(s => ({
      name: s.instance.name, baseUrl: s.instance.baseUrl,
      priority: s.priority, enabled: s.enabled
    }));
  }
}

module.exports = ScraperManager;
