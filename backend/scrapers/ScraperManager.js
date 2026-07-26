/**
 * Embed source manager — TMDB-based iframe players.
 * Ordered cleanest / autoplay-friendly first. No server health filter
 * (many hosts block bots but work in the browser).
 */

function q(url, extra) {
  if (!url) return url;
  const join = url.includes('?') ? '&' : '?';
  return url + join + extra;
}

class S {
  constructor(name, base) {
    this.name = name;
    this.baseUrl = base;
  }
  buildUrl() { return ''; }
  async getSource(id, type, s, e) {
    const url = this.buildUrl(id, type, s, e);
    if (!url) return null;
    return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
  }
}

// ── Clean / autoplay-first ─────────────────────────────────
class VidLinkPro extends S {
  constructor() { super('vidlink', 'https://vidlink.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}?primaryColor=e50914&autoplay=true&title=false&poster=false&nextbutton=true`
      : `${this.baseUrl}/movie/${id}?primaryColor=e50914&autoplay=true&title=false&poster=false`;
  }
}

class VidSrcWiki extends S {
  constructor() { super('vidsrc.wiki', 'https://vidsrc.wiki'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}?autoplay=1&color=e50914`
      : `${this.baseUrl}/embed/movie/${id}?autoplay=1&color=e50914`;
  }
}

class VidSrcCC extends S {
  constructor() { super('vidsrc.cc', 'https://vidsrc.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/v3/embed/tv/${id}/${s}/${e}?autoPlay=true&poster=false`
      : `${this.baseUrl}/v3/embed/movie/${id}?autoPlay=true&poster=false`;
  }
}

class VidSrcCC2 extends S {
  constructor() { super('vidsrc.cc/v2', 'https://vidsrc.cc'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/v2/embed/tv/${id}/${s}/${e}?autoPlay=true`
      : `${this.baseUrl}/v2/embed/movie/${id}?autoPlay=true`;
  }
}

class VidFast extends S {
  constructor() { super('vidfast', 'https://vidfast.pro'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}?autoPlay=true&title=false`
      : `${this.baseUrl}/movie/${id}?autoPlay=true&title=false`;
  }
}

class VidSrcMe extends S {
  constructor() { super('vidsrc', 'https://vidsrc.me'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv?tmdb=${id}&season=${s}&episode=${e}&autoplay=1`
      : `${this.baseUrl}/embed/movie?tmdb=${id}&autoplay=1`;
  }
}

class VidSrcEmbedRu extends S {
  constructor() { super('vidsrc-embed', 'https://vidsrc-embed.ru'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv?tmdb=${id}&season=${s}&episode=${e}&autoplay=1&autonext=1`
      : `${this.baseUrl}/embed/movie?tmdb=${id}&autoplay=1`;
  }
}

class VidSrcIn extends S {
  constructor() { super('vidsrc.in', 'https://vidsrc.in'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=1');
  }
}

class VidSrcPro extends S {
  constructor() { super('vidsrc.pro', 'https://vidsrc.pro'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=1');
  }
}

class VidSrcNL extends S {
  constructor() { super('vidsrc.nl', 'https://player.vidsrc.nl'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=1');
  }
}

class VidSrcXyz extends S {
  constructor() { super('vidsrc.xyz', 'https://vidsrc.xyz'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv?tmdb=${id}&season=${s}&episode=${e}&autoplay=1`
      : `${this.baseUrl}/embed/movie?tmdb=${id}&autoplay=1`;
  }
}

class VidSrcICU extends S {
  constructor() { super('vidsrc.icu', 'https://vidsrc.icu'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=1');
  }
}

class VidSrcVip extends S {
  constructor() { super('vidsrc.vip', 'https://vidsrc.vip'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=1');
  }
}

class VidSrcRip extends S {
  constructor() { super('vidsrc.rip', 'https://vidsrc.rip'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class AutoEmbed extends S {
  constructor() { super('autoembed', 'https://player.autoembed.cc'); }
  buildUrl(id, t, s, e) {
    const base = t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
    return q(base, 'autoplay=true');
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

class TwoEmbed extends S {
  constructor() { super('2embed', 'https://www.2embed.cc'); }
  buildUrl(id, t, s, e) {
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

class TwoEmbedSkin extends S {
  constructor() { super('2embed.skin', 'https://www.2embed.skin'); }
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
    const qs = t === 'tv' && s && e
      ? `video_id=${id}&tmdb=1&s=${s}&e=${e}`
      : `video_id=${id}&tmdb=1`;
    return `https://multiembed.mov/directstream.php?${qs}`;
  }
}

class Vidify extends S {
  constructor() { super('vidify', 'https://player.vidify.top'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}?autoplay=true`
      : `${this.baseUrl}/embed/movie/${id}?autoplay=true`;
  }
}

class Videasy extends S {
  constructor() { super('videasy', 'https://player.videasy.net'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}?autoplay=true`
      : `${this.baseUrl}/movie/${id}?autoplay=true`;
  }
}

class BlackVid extends S {
  constructor() { super('blackvid', 'https://blackvid.space'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed?tmdb=${id}&season=${s}&episode=${e}`
      : `${this.baseUrl}/embed?tmdb=${id}`;
  }
}

class EmbedRs extends S {
  constructor() { super('embed.rs', 'https://embed.rs'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/movie/${id}`;
  }
}

class Moviee extends S {
  constructor() { super('moviee', 'https://moviee.tv'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcTo extends S {
  constructor() { super('vidsrc.to', 'https://vidsrc.to'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcNet extends S {
  constructor() { super('vidsrc.net', 'https://vidsrc.net'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class VidSrcPmux extends S {
  constructor() { super('vidsrc.pm', 'https://vidsrc.pm'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class FilmsToWatch extends S {
  constructor() { super('filmstu', 'https://www.2embed.cc'); }
  buildUrl(id, t, s, e) {
    // alternate 2embed path style
    return t === 'tv' && s && e
      ? `https://www.2embed.cc/embedtv/${id}?s=${s}&e=${e}`
      : `https://www.2embed.cc/embed/${id}`;
  }
}

class RgShows extends S {
  constructor() { super('rgshows', 'https://embed.rgshows.me'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/?tmdb=${id}&s=${s}&e=${e}`
      : `${this.baseUrl}/?tmdb=${id}`;
  }
}

class VidsrcSx extends S {
  constructor() { super('vidsrc.sx', 'https://vidsrc.sx'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class Embed123 extends S {
  constructor() { super('123embed', 'https://play.123embed.net'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/movie/${id}`;
  }
}

class Hopcloud extends S {
  constructor() { super('hopcloud', 'https://hopcloudflare.lol'); }
  buildUrl(id, t, s, e) {
    return t === 'tv' && s && e
      ? `${this.baseUrl}/embed/tv/${id}/${s}/${e}`
      : `${this.baseUrl}/embed/movie/${id}`;
  }
}

class ScraperManager {
  constructor() {
    this.scrapers = [
      { instance: new VidLinkPro(),     priority: 1,  enabled: true },
      { instance: new VidSrcWiki(),     priority: 2,  enabled: true },
      { instance: new VidSrcCC(),       priority: 3,  enabled: true },
      { instance: new VidFast(),        priority: 4,  enabled: true },
      { instance: new VidSrcEmbedRu(),  priority: 5,  enabled: true },
      { instance: new VidSrcCC2(),      priority: 6,  enabled: true },
      { instance: new VidSrcMe(),       priority: 7,  enabled: true },
      { instance: new VidSrcIn(),       priority: 8,  enabled: true },
      { instance: new Videasy(),        priority: 9,  enabled: true },
      { instance: new Vidify(),         priority: 10, enabled: true },
      { instance: new AutoEmbed(),      priority: 11, enabled: true },
      { instance: new VidSrcPro(),      priority: 12, enabled: true },
      { instance: new VidSrcNL(),       priority: 13, enabled: true },
      { instance: new VidSrcXyz(),      priority: 14, enabled: true },
      { instance: new VidSrcICU(),      priority: 15, enabled: true },
      { instance: new VidSrcVip(),      priority: 16, enabled: true },
      { instance: new VidSrcRip(),      priority: 17, enabled: true },
      { instance: new VidSrcTo(),       priority: 18, enabled: true },
      { instance: new VidSrcNet(),      priority: 19, enabled: true },
      { instance: new VidSrcPmux(),     priority: 20, enabled: true },
      { instance: new VidsrcSx(),       priority: 21, enabled: true },
      { instance: new EmbedSu(),        priority: 22, enabled: true },
      { instance: new EmbedRs(),        priority: 23, enabled: true },
      { instance: new TwoEmbed(),       priority: 24, enabled: true },
      { instance: new TwoEmbedOrg(),    priority: 25, enabled: true },
      { instance: new TwoEmbedSkin(),   priority: 26, enabled: true },
      { instance: new MultiEmbed(),     priority: 27, enabled: true },
      { instance: new MoviesApi(),      priority: 28, enabled: true },
      { instance: new SmashyStream(),   priority: 29, enabled: true },
      { instance: new SuperEmbed(),     priority: 30, enabled: true },
      { instance: new BlackVid(),       priority: 31, enabled: true },
      { instance: new Moviee(),         priority: 32, enabled: true },
      { instance: new RgShows(),        priority: 33, enabled: true },
      { instance: new Embed123(),       priority: 34, enabled: true },
      { instance: new Hopcloud(),       priority: 35, enabled: true },
      { instance: new NontonGo(),       priority: 36, enabled: true },
      { instance: new FilmsToWatch(),   priority: 37, enabled: true },
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
          new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 4000))
        ]);
        if (source && source.embedUrl) {
          results.push({ ...source, priority: scraper.priority, elapsed: Date.now() - t });
        }
      } catch (e) {
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
