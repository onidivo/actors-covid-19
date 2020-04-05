const Apify = require('apify');

const LATEST = 'LATEST';
const now = new Date();
const { log } = Apify.utils;

Apify.main(async () => {
    const url = 'https://esriportugal.maps.arcgis.com/apps/opsdashboard/index.html#/acf023da9a0b4f9dbb2332c13f635829';

    const kvStore = await Apify.openKeyValueStore('COVID-19-PORTUGAL');
    const dataset = await Apify.openDataset('COVID-19-PORTUGAL-HISTORY');

    const browser = await Apify.launchPuppeteer({ useApifyProxy: true });
    const page = await browser.newPage();
    await Apify.utils.puppeteer.injectJQuery(page);
    await Apify.utils.puppeteer.blockRequests(page, {
        urlPatterns: [".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip", '.pbf', '.woff2', '.woff']
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 1000 * 600 });

    const extracted = await page.evaluate(() => {
        function getInfectedByRegion($ps) {
            const infectedByRegion = [];
            for (const p of $ps) {
                const value = $(p).find('strong').first().text().trim();
                const key = $(p).find('strong').last().text().trim();
                infectedByRegion.push({
                    value: parseInt(value),
                    region: key
                })
            }
            return infectedByRegion;
        }

        const full_container = $('full-container').first().children();

        const date = full_container.find("div:contains(Dados relativos ao boletim da DGS de)").eq(2).find('g').last().text().trim()
        const suspicious = full_container.eq(4).find('g').last().text().replace(/(\n|,| )/g, '');
        const infected = full_container.eq(1).find('g').last().text().replace(/(\n|,| )/g, '');
        const recovered = full_container.eq(2).find('g').last().text().replace(/(\n|,| )/g, '');
        const deceased = full_container.eq(3).find('g').last().text().replace(/(\n|,| )/g, '');

        const $ps = full_container.eq(11).find('nav p').toArray();


        const infectedByRegion = getInfectedByRegion($ps);

        return {
            date, suspicious, infected, recovered, deceased, infectedByRegion
        };
    });

    let { date, suspicious, infected, recovered, deceased, infectedByRegion } = extracted;
    let sourceDate = new Date(formatDate(date));


    // ADD: suspicious, infected, recovered, deaths
    const data = {
        infected: infected || infected === '0' ? parseInt(infected) : 'N/A',
        tested: 'N/A',
        suspicious: suspicious || suspicious === '0' ? parseInt(suspicious) : 'N/A',
        recovered: recovered || recovered === '0' ? parseInt(recovered) : 'N/A',
        deceased: deceased || deceased === '0' ? parseInt(deceased) : null
    }


    // ADD: infectedByRegion, lastUpdatedAtApify, lastUpdatedAtSource
    if (infectedByRegion && infectedByRegion.length) data.infectedByRegion = infectedByRegion;
    data.country = 'Portugal';
    data.historyData = 'https://api.apify.com/v2/datasets/f1Qd4cMBzV1E0oRNc/items?format=json&clean=1';
    data.sourceUrl = 'https://covid19.min-saude.pt/ponto-de-situacao-atual-em-portugal/';
    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
    if (sourceDate != 'Invalid Date') data.lastUpdatedAtSource = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate(), sourceDate.getHours(), sourceDate.getMinutes())).toISOString();
    data.readMe = 'https://apify.com/onidivo/covid-pt';

    // Push the data
    let latest = await kvStore.getValue(LATEST);
    if (!latest) {
        await kvStore.setValue('LATEST', data);
        latest = Object.assign({}, data);
    }
    delete latest.lastUpdatedAtApify;
    const actual = Object.assign({}, data);
    delete actual.lastUpdatedAtApify;

    const { itemCount } = await dataset.getInfo();
    if (JSON.stringify(latest) !== JSON.stringify(actual) || itemCount === 0) {
        await dataset.pushData(data);
    }

    await kvStore.setValue('LATEST', data);
    await Apify.pushData(data);

    log.info('Data saved.');

    log.info('Closing Puppeteer...');
    await browser.close();
    log.info('Done.');
});

function formatDate(date) {
    const arr = date.replace(/(\n)/g, '').trim().split('/');
    [a, b, ...others] = [...arr];
    return Array.from([b, a, ...others]).join('-');
}
