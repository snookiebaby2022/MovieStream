const BaseScraper = require('./BaseScraper');

class RiveStreamScraper extends BaseScraper {
    constructor() {
        super('rivestream', 'https://rivestream.live');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/embed?type=tv&id=${tmdbId}&season=${season}&episode=${episode}`;
            } else {
                url = `${this.baseUrl}/embed?type=movie&id=${tmdbId}`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': this.baseUrl } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = RiveStreamScraper;
