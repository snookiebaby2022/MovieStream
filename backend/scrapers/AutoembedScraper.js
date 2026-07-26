const BaseScraper = require('./BaseScraper');

class AutoembedScraper extends BaseScraper {
    constructor() {
        super('autoembed', 'https://autoembed.co');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/embed/tv/${tmdbId}-${season}-${episode}`;
            } else {
                url = `${this.baseUrl}/embed/movie/${tmdbId}`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': this.baseUrl } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = AutoembedScraper;
