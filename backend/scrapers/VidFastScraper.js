const BaseScraper = require('./BaseScraper');

class VidFastScraper extends BaseScraper {
    constructor() {
        super('vidfast', 'https://vidfast.pro');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/tv/${tmdbId}/${season}/${episode}`;
            } else {
                url = `${this.baseUrl}/movie/${tmdbId}`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': this.baseUrl } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = VidFastScraper;
