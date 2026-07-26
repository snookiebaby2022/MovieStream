const BaseScraper = require('./BaseScraper');

class SuperEmbedScraper extends BaseScraper {
    constructor() {
        super('superembed', 'https://multiembed.mov');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
            } else {
                url = `${this.baseUrl}/?video_id=${tmdbId}&tmdb=1`;
            }

            const response = await this.fetch(url, {
                headers: { 'Referer': this.baseUrl }
            });

            if (response.status === 200 && response.data.length > 100) {
                return {
                    source: this.name,
                    type: 'embed',
                    url: url,
                    quality: 'Auto',
                    embedUrl: url
                };
            }
            return null;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = SuperEmbedScraper;
