const BaseScraper = require('./BaseScraper');

class VidSrcMeScraper extends BaseScraper {
    constructor() {
        super('vidsrc-me', 'https://v2.vidsrc.me');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/embed/tv/${tmdbId}/${season}-${episode}/`;
            } else {
                url = `${this.baseUrl}/embed/${tmdbId}/`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': 'https://vidsrc.me' } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = VidSrcMeScraper;
