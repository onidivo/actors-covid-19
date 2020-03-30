// main.js
const Apify = require('apify');
const { log } = Apify.utils;

const LATEST = "LATEST";
const now = new Date();

Apify.main(async () => {
    log.info('Starting actor.');

    const kvStore = await Apify.openKeyValueStore("COVID-19-SOUTH-KOREA");
    const dataset = await Apify.openDataset("COVID-19-SOUTH-KOREA-HISTORY");

    const requestQueue = await Apify.openRequestQueue();

    await requestQueue.addRequest({
        url: 'https://www.cdc.go.kr/board/board.es?mid=&bid=0030',
        userData: {
            label: 'START'
        }
    })

    log.debug('Setting up crawler.');
    const cheerioCrawler = new Apify.CheerioCrawler({
        requestQueue,
        maxRequestRetries: 5,
        handlePageTimeoutSecs: 60,
        useApifyProxy: true,
        useSessionPool: true,
        additionalMimeTypes: ['text/plain'],
        sessionPoolOptions: {
            maxPoolSize: 100,
            sessionOptions: {
                maxUsageCount: 5,
            },
        },
        handlePageFunction: async ({ request, $ }) => {
            log.info(`Processing ${request.url}`);
            const { label } = request.userData;
            switch (label) {
                case 'START':
                    const $href = $('.dbody ul').first().find('a').attr('href');
                    const list_no = new URLSearchParams($href).get('list_no');
                    const bid = new URLSearchParams($href).get('bid');
                    await requestQueue.addRequest({
                        url: `https://www.cdc.go.kr/board/board.es?mid=&bid=${bid}`,
                        uniqueKey: list_no,
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                        },
                        userData: {
                            label: 'DATA',
                        },
                        payload: `mid=&bid=${bid}&nPage=1&b_list=10&orderby=&dept_code=`
                            + `&tag=&list_no=${list_no}&act=view&keyField=TITLE&keyWord=`
                    });
                    break;
                case 'DATA':
                    log.info(`Processing and saving data.`);
                    let data = firstTable = secondTable = thirdTable = {};

                    // First Table
                    const firstIndex = await getTableIndex($
                        , new RegExp(/period(.*)total(.*)positive(.*)being(.*)negative/g));
                    if (typeof firstIndex === "number") {
                        const firstTbody = $('#content_detail div.tb_contents tbody').eq(firstIndex);
                        firstTable = await extractFirstTableData(firstTbody, $);
                    }

                    // Third Table
                    const thirdIndex = await getTableIndex($
                        , new RegExp(/confirmed(.*)deaths(.*)fatality(.*)/g));
                    if (typeof thirdIndex === "number") {
                        const thirdTbody = $('#content_detail div.tb_contents tbody').eq(thirdIndex);
                        thirdTable = await extractThirdTableData(thirdTbody, $);
                    }
                    const { infectedByAgeGroup } = thirdTable;

                    // ADD: total, infected, discharged, isolated, deceased, beingTested, testedNegative
                    Object.keys(firstTable).forEach(function (key) {
                        data[key] = firstTable[key];
                    });

                    // ADD: deaths,infectedByRegion, infectedByAgeGroup
                    if (infectedByAgeGroup && infectedByAgeGroup.length) data.infectedByAgeGroup = infectedByAgeGroup;

                    // Source Date
                    const $sourceDate = $('ul[class="head info"] li:nth-child(1) b').text().trim();
                    const $date = new Date($sourceDate)

                    //ADD: sourceUrl, lastUpdatedAtSource, lastUpdatedAtApify, readMe
                    data.country = 'South Korea';
                    data.moreData = 'https://api.apify.com/v2/key-value-stores/TMFbhs7qtXpGpeaeP/records/LATEST?disableRedirect=true';
                    data.historyData = 'https://api.apify.com/v2/datasets/T43VVY5mDBeFMyRcn/items?format=json&clean=1';
                    data.sourceUrl = request.url;
                    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
                    data.lastUpdatedAtSource = new Date(Date.UTC($date.getFullYear(), $date.getMonth(), $date.getDate(), ($date.getHours() - 9), $date.getMinutes())).toISOString();
                    data.readMe = 'https://apify.com/onidivo/covid-kr';

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

                    console.log('Done.');
                    break
                default:
                    break;
            }
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

async function getTableIndex($, regex) {
    const tbodys = $('#content_detail div.tb_contents tbody').toArray();
    let index = -1;
    for (const tbody of tbodys) {
        index++;
        const innertext = $(tbody).find('tr').first().text().replace(/(\r|\n|,| )/g, '').toLowerCase();
        if (regex.test(innertext)) return index;
    }
}

async function extractFirstTableData(tbody, $) {
    let $tds = $(tbody).find('tr').last().prev().find('td');
    const fields = ['total', 'infected', 'discharged', 'isolated', 'deceased', 'beingTested', 'testedNegative'];
    const result = {}
    fields.forEach((field, i) => {
        const value = $($tds).eq(i + 1).text().replaceAll();
        if (value || value === '0') {
            result[field] = parseInt(value);
        }
        else {
            if (fields === 'deceased') {
                result[field] = null;
                return;
            }
            result[field] = 'N/A';
        }
    });
    return result;
}

String.prototype.replaceAll = function () {
    return this.replace(/(,|\n|\r| )/g, '');
};

async function extractThirdTableData(tbody, $) {
    const infectedByAgeGroup = [];
    let deaths = null;

    $(tbody).find('tr').toArray().forEach((tr, i) => {
        let tds = $(tr).find('td');
        let { length } = tds;
        if (length === 6 || length === 7) {
            if (i === 0) return;
            if (i === 1) {
                deaths = $(tds).eq(3).text().replaceAll();
                return;
            }
            if (length === 7) tds = $(tds).slice(1);
            infectedByAgeGroup.push({
                key: $(tds).eq(0).text().trim(),
                infected: parseInt($(tds).eq(1).text().replaceAll()),
                deaths: parseInt($(tds).eq(3).text().replaceAll()),
            })
        }
    });
    return { deaths, infectedByAgeGroup };
}
