const BaseScraper = require('./BaseScraper');

class TwoEmbedScraper extends BaseScraper {
    constructor() {
        super('2embed', 'https://www.2embed.cc');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/embedtv/${tmdbId}&s=${season}&e=${episode}`;
            } else {
                url = `${this.baseUrl}/embed/${tmdbId}`;
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

module.exports = TwoEmbedScraper;
