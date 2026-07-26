const BaseScraper = require('./BaseScraper');

class VidSrcProScraper extends BaseScraper {
    constructor() {
        super('vidsrc-pro', 'https://vidsrc.pro');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
            } else {
                url = `${this.baseUrl}/embed/movie?tmdb=${tmdbId}`;
            }
            const r = await this.fetch(url, { headers: { 'Referer': this.baseUrl } });
            if (r.status === 200 && r.data.length > 200) {
                return { source: this.name, type: 'embed', url, quality: 'Auto', embedUrl: url };
            }
            return null;
        } catch(e) { throw e; }
    }
}
module.exports = VidSrcProScraper;
