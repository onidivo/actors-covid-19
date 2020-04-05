const Apify = require('apify');
const { log } = Apify.utils;

const LATEST = 'LATEST';
const now = new Date();
Apify.main(async () => {
    const sourceUrl = 'https://msprh-dz.maps.arcgis.com/apps/opsdashboard/index.html#/eb524fcb95374f2cb60352b426e6e340';

    const kvStore = await Apify.openKeyValueStore('COVID-19-ALGERIA');
    const dataset = await Apify.openDataset('COVID-19-ALGERIA-HISTORY');

    const browser = await Apify.launchPuppeteer({ useApifyProxy: true });
    const page = await browser.newPage();
    await Apify.utils.puppeteer.injectJQuery(page);
    await Apify.utils.puppeteer.blockRequests(page, {
        urlPatterns: [".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip"
            , '.pbf', '.woff2', '.woff']
    });

    await page.goto(sourceUrl, { waitUntil: 'networkidle0', timeout: 1000 * 600 });

    const extracted = await page.evaluate(() => {
        function getInfectedByRegion($spans) {
            const infectedByRegion = [];
            for (const span of $spans) {
                const text = $(span).text();
                const matchs = text.match(/(\d,*)+/g);
                infectedByRegion.push({
                    value: matchs[0] ? parseInt(matchs[0].replace(/,/g, '')) : 0,
                    region: text.match(/([a-z '-]+)/gi).filter(el => el.trim() !== '')[0].replace(/-/g, ' ').trim(),
                    newly: matchs[1] ? parseInt(matchs[1].replace(/,/g, '')) : 0
                })
            }
            return infectedByRegion;
        }

        const date = $("p:contains(Mise à jour)").text().match(/(\d|\/)+/g)[0];

        const hospitalized = $("g:contains(Sous Traitement)").parents().eq(2).text().match(/(\d,*)+/g)[0].replace(/,/g, '');
        const infected = $("g:contains(الحالات المؤكدة)").parents().eq(2).text().match(/(\d,*)+/g)[0].replace(/,/g, '');
        const recovered = $("g:contains(Cas guéris)").parents().eq(2).text().match(/(\d,*)+/g)[0].replace(/,/g, '');
        const deceased = $("g:contains(Décès)").parents().eq(2).text().match(/(\d,*)+/g)[0].replace(/,/g, '');

        const $spans = $("nav.feature-list").last().find('div.list-item-content').toArray();

        const infectedByRegion = getInfectedByRegion($spans);

        return {
            date, hospitalized, infected, recovered, deceased, infectedByRegion
        };
    });

    let { date, hospitalized, infected, recovered, deceased, infectedByRegion } = extracted;

    let sourceDate = new Date(await formatDate(date));


    // ADD: suspicious, infected, recovered, deaths
    const data = {
        infected: parseInt(infected) || 'N/A',
        tested: 'N/A',
        hospitalized: parseInt(hospitalized) || 'N/A',
        recovered: parseInt(recovered) || 'N/A',
        deceased: parseInt(deceased) || null
    }


    // ADD: infectedByRegion, lastUpdatedAtApify, lastUpdatedAtSource
    if (infectedByRegion && infectedByRegion.length) data.infectedByRegion = infectedByRegion;
    data.country = 'Algeria';
    data.historyData = 'https://api.apify.com/v2/datasets/VeXjF7u71PU8IO6NH/items?format=json&clean=1';
    data.sourceUrl = 'http://covid19.sante.gov.dz/carte';
    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
    data.lastUpdatedAtSource = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate(), sourceDate.getHours(), sourceDate.getMinutes())).toISOString();
    data.readMe = 'https://apify.com/onidivo/covid-dz';

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

async function formatDate(date) {
    [a, b, c] = date.split('/');
    return `${b}/${a}/${c}`;
}
