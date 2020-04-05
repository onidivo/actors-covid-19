// main.js
const Apify = require('apify');
var parser = require('fast-xml-parser');
const { log } = Apify.utils;


const LATEST = "LATEST";
const now = new Date();
const sourceUrl = 'https://corona.ps';

Apify.main(async () => {

    log.info('Starting actor.');

    const kvStore = await Apify.openKeyValueStore("COVID-19-PALESTINE");
    const dataset = await Apify.openDataset("COVID-19-PALESTINE-HISTORY");

    const requestList = await Apify.openRequestList('my-request-list', [
        { url: 'https://corona.ps/API/summary?format=xml', userData: { label: 'SUMMARY' } },
        { url: 'https://corona.ps/API/governorates?format=xml', userData: { label: 'GOVERNORATES' } },
    ]);
    let summary, summaryDone, governorate, governoratesDone;

    log.debug('Setting up crawler.');
    const cheerioCrawler = new Apify.CheerioCrawler({
        requestList,
        maxRequestRetries: 5,
        useApifyProxy: true,
        additionalMimeTypes: ['application/xml'],
        handlePageFunction: async ({ request, $, body }) => {
            const { url, userData: { label } } = request;
            log.info(`Processing ${url}`);
            switch (label) {
                case 'SUMMARY':
                    summary = parser.parse(body).data;
                    summaryDone = true;
                    break;
                case 'GOVERNORATES':
                    governorate = parser.parse(body).data.governorates.governorate;
                    governoratesDone = true;
                    break;
            }
            if (!summaryDone | !governoratesDone) return;
            log.info(`Processing and saving data.`);

            const { lastupdated: lastUpdated, totalcases: infected, totalrecovery: recovered,
                totalactivecases: totalActiveCases, totaldeath: deceased,
                totalcriticalcases: totalCriticalCases, totaltestedsamples: tested,
                homequarantine: homeQuarantine, centralquarantine: centralQuarantine
            } = summary;

            governorate = governorate.map(({ name, cases, centralquarantine, homequarantine }) => {
                return { name, cases, centralQuarantine: centralquarantine, homeQuarantine: homequarantine };
            });

            const data = {
                infected, tested, recovered, deceased, totalActiveCases, totalCriticalCases,
                homeQuarantine, centralQuarantine, infectedByregion: governorate
            };

            // source Date
            const atSource = new Date(lastUpdated);

            //ADD: sourceUrl, lastUpdatedAtSource, lastUpdatedAtApify, readMe
            data.country = 'Palestine';
            data.historyData = 'https://api.apify.com/v2/datasets/BKpHLQrJPmgXE51tf/items?format=json&clean=1';
            data.sourceUrl = sourceUrl;
            data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
            data.lastUpdatedAtSource = new Date(Date.UTC(atSource.getFullYear(), atSource.getMonth(), atSource.getDate(), (atSource.getHours()), atSource.getMinutes())).toISOString();
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

