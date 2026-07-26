const BaseScraper = require('./BaseScraper');

class VidLinkScraper extends BaseScraper {
    constructor() {
        super('vidlink', 'https://vidlink.pro');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/tv/${tmdbId}/${season}/${episode}`;
            } else {
                url = `${this.baseUrl}/movie/${tmdbId}`;
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

module.exports = VidLinkScraper;
