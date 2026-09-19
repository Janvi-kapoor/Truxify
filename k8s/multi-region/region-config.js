export function parseRegionsConfig(value) {
    let config;

    try {
        config = JSON.parse(value);
    } catch (error) {
        throw new Error(`REGIONS must be valid JSON: ${error.message}`, { cause: error });
    }

    if (!Array.isArray(config) || config.length === 0) {
        throw new Error('REGIONS must be a non-empty JSON array of region objects');
    }

    config.forEach((region, index) => {
        if (region === null || typeof region !== 'object' || Array.isArray(region)) {
            throw new Error(`REGIONS[${index}] must be a region object`);
        }
    });

    return config;
}
