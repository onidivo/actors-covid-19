// main.js
const Apify = require('apify');
const { log } = Apify.utils;

const LATEST = "LATEST";
const now = new Date();
const sourceUrl = 'https://www.worldometers.info/coronavirus/country/iran';

Apify.main(async () => {

    log.info('Starting actor.');

    const kvStore = await Apify.openKeyValueStore("COVID-19-IRAN");
    const dataset = await Apify.openDataset("COVID-19-IRAN-HISTORY");

    const requestQueue = await Apify.openRequestQueue();

    await requestQueue.addRequest({
        url: sourceUrl,
    })

    log.debug('Setting up crawler.');
    const cheerioCrawler = new Apify.CheerioCrawler({
        requestQueue,
        maxRequestRetries: 5,
        useApifyProxy: true,
        additionalMimeTypes: ['text/plain'],
        handlePageFunction: async ({ request, $ }) => {
            log.info(`Processing ${request.url}`);
            log.info(`Processing and saving data.`);
            const data = {};

            const $spans = $('div #maincounter-wrap span');

            data.infected = parseInt($($spans).eq(0).text().replace(/( |,)/g, '')) || 'N/A';
            data.tested = 'N/A'
            data.recovered = parseInt($($spans).eq(1).text().replace(/( |,)/g, '')) || 'N/A';
            data.deceased = parseInt($($spans).eq(2).text().replace(/( |,)/g, '')) || null;

            // Source Date
            const $date = $(".content-inner div:contains(Last updated)").text();
            const atSource = new Date($date.replace(/Last updated: /g, ''));

            //ADD: sourceUrl, lastUpdatedAtSource, lastUpdatedAtApify, readMe
            data.country = 'Iran';
            data.historyData = 'https://api.apify.com/v2/datasets/PJEXhmQM0hkN8K3BK/items?format=json&clean=1';
            data.sourceUrl = sourceUrl;
            data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
            data.lastUpdatedAtSource = new Date(Date.UTC(atSource.getFullYear(), atSource.getMonth(), atSource.getDate(), (atSource.getHours()), atSource.getMinutes())).toISOString();
            data.readMe = 'https://apify.com/onidivo/covid-ir';

            // Push the data
            let latest = await kvStore.getValue(LATEST);
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

            log.info('Data saved.');

        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed many times.`);
            console.dir(request)
        },
    });
    // Run the crawler and wait for it to finish.
    log.info('Starting the crawl.');
    await cheerioCrawler.run();
    log.info('Actor finished.');
});

