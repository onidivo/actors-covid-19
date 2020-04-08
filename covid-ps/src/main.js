const Apify = require('apify');
const { log } = Apify.utils;

const LATEST = 'LATEST';
const now = new Date();
Apify.main(async () => {
    const sourceUrl = 'https://portal.geomolg.ps/portal/apps/opsdashboard/index.html#/63d63a6d45f44621b361d8a53c235d46';

    const kvStore = await Apify.openKeyValueStore('COVID-19-PALESTINE');
    const dataset = await Apify.openDataset('COVID-19-PALESTINE-HISTORY');

    const browser = await Apify.launchPuppeteer({ useApifyProxy: true });
    const page = await browser.newPage();
    await Apify.utils.puppeteer.injectJQuery(page);
    await Apify.utils.puppeteer.blockRequests(page, {
        urlPatterns: [".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip"
            , '.pbf', '.woff2', '.woff']
    });
    await page.goto(sourceUrl, { timeout: 1000 * 600 });

    const selector = `document.querySelectorAll(('full-container.layout-reference full-container'))`

    await page.waitForFunction(
        `${selector}[0].innerText.includes('الاصابات المؤكدة التراكمية')`,
        `${selector}[1].innerText.includes('الشفاء التام')`,
        `${selector}[2].innerText.includes('الحالات المؤكدة حسب')`,
        `${selector}[5].innerText.includes('الحجر المنزلي')`,
        `${selector}[7].innerText.includes('عدد الوفيات')`,
    );

    const extracted = await page.evaluate(async () => {

        async function strToInt(str) {
            return parseInt(str.replace(/( |,)/g, ''))
        }

        const fullContainer = $('full-container.layout-reference full-container').toArray();

        const infected = await strToInt($(fullContainer[0]).find('g').last().text().trim());
        const recovered = await strToInt($(fullContainer[1]).find('g').last().text().trim());
        const deceased = await strToInt($(fullContainer[7]).find('g').last().text().trim());
        const atHome = await strToInt($(fullContainer[5]).find('g').last().text().trim());

        const spans = $(fullContainer[2]).find('span[id*="ember"]').toArray();

        const infectedByRegion = [];
        spans.forEach(async (span) => {
            const strongs = $(span).find('strong')
            infectedByRegion.push({
                value: await strToInt(strongs[0].innerText),
                region: strongs[1].innerText.match(/([A-Z']+)/gi).join(' ').trim(),
            })
        })

        return {
            infected, recovered, deceased, atHome, infectedByRegion
        };
    });

    log.info('Processing and saving data.')

    // ADD: tested, infected, recovered, deceased, atHome, infectedByRegion
    const data = {
        tested: 'N/A',
        ...extracted
    }

    //ADD: historyData, country, sourceUrl, lastUpdatedAtSource, lastUpdatedAtApify, readMe
    data.country = 'Palestine';
    data.historyData = 'https://api.apify.com/v2/datasets/BKpHLQrJPmgXE51tf/items?format=json&clean=1';
    data.sourceUrl = sourceUrl;
    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
    data.lastUpdatedAtSource = 'N/A';
    data.readMe = 'https://apify.com/onidivo/covid-ps';

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
