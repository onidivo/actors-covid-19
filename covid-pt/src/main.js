const Apify = require('apify');

const LATEST = 'LATEST';
const now = new Date();
Apify.main(async () => {
    const url = 'https://esriportugal.maps.arcgis.com/apps/opsdashboard/index.html#/acf023da9a0b4f9dbb2332c13f635829';

    const kvStore = await Apify.openKeyValueStore('COVID-19-PT');
    const dataset = await Apify.openDataset('COVID-19-PY-HISTORY');

    const browser = await Apify.launchPuppeteer({useApifyProxy: true, apifyProxyGroups: ['SHADER']});
    const page = await browser.newPage();
    await Apify.utils.puppeteer.injectJQuery(page);
    await Apify.utils.puppeteer.blockRequests(page, {
        urlPatterns: [".jpg", ".jpeg", ".png", ".svg", ".gif", ".woff", ".pdf", ".zip"]
    });

    await page.goto(url, {waitUntil: 'networkidle0', timeout: 1000 * 600});
    await page.waitForSelector('full-container')

    const extracted = await page.evaluate(() => {
        function getInfectedByRegion($ps) {
            const infectedByRegion = [];
            for (const p of $ps) {
                const value = $(p).find('strong').first().text().trim();
                const key = $(p).find('strong').last().text().trim();
                infectedByRegion.push({
                    value,
                    region: key
                })
            }
            return infectedByRegion;
        }

        const full_container = $('full-container').first().children();

        const date = full_container.eq(5).find('g').last().text().trim();
        const totalTested = full_container.eq(4).find('g').last().text().replace(/(\n|,| )/g, '');
        const infected = full_container.eq(1).find('g').last().text().replace(/(\n|,| )/g, '');
        const recovered = full_container.eq(2).find('g').last().text().replace(/(\n|,| )/g, '');
        const deaths = full_container.eq(3).find('g').last().text().replace(/(\n|,| )/g, '');

        const $ps = full_container.eq(11).find('nav p').toArray();


        const infectedByRegion = getInfectedByRegion($ps);

        return {
            date, totalTested, infected, recovered, deaths, infectedByRegion
        };
    });

    let {date, totalTested, infected, recovered, deaths, infectedByRegion} = extracted;

    let sourceDate = new Date(formatDate(date));

    // ADD: totalTested, infected, recovered, deaths
    const data = {totalTested, infected, recovered, deaths}

    let latest = await kvStore.getValue(LATEST);

    // ADD: infectedByRegion, lastUpdatedAtApify, lastUpdatedAtSource
    if (infectedByRegion.length) data.infectedByRegion = infectedByRegion;
    data.sourceUrl = 'https://covid19.min-saude.pt/ponto-de-situacao-atual-em-portugal/';
    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
    if (sourceDate != 'Invalid Date') data.lastUpdatedAtSource = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate(), sourceDate.getHours(), sourceDate.getMinutes())).toISOString();
    data.readMe = 'https://apify.com/onidivo/covid-pt';
    if (!latest) {
        await kvStore.setValue('LATEST', data);
        latest = data;
    }
    delete latest.lastUpdatedAtApify;
    const actual = Object.assign({}, data);
    delete actual.lastUpdatedAtApify;

    if (JSON.stringify(latest) !== JSON.stringify(actual)) {
        await dataset.pushData(data);
    }

    await kvStore.setValue('LATEST', data);
    await Apify.pushData(data);

    console.log('Closing Puppeteer...');
    await browser.close();
    console.log('Done.');
});

function customDate() {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString()
}

function formatDate(date) {
    const arr = date.replaceAll('\n', '').trim().split('/');
    const first = arr[0];
    arr[0] = arr[1];
    arr[1] = first;
    return arr.join('-');
}

function isTimeToCheckCases() {
    return now.getHours() === 1 && now.getMinutes() < 5;
}

String.prototype.replaceAll = function (find, replace) {
    var str = this;
    return str.replace(new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replace);
};
