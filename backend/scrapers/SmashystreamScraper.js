const BaseScraper = require('./BaseScraper');

class SmashystreamScraper extends BaseScraper {
    constructor() {
        super('smashystream', 'https://player.smashy.stream');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/tv?id=${tmdbId}&s=${season}&e=${episode}`;
            } else {
                url = `${this.baseUrl}/movie?id=${tmdbId}`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': 'https://smashy.stream' } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = SmashystreamScraper;
