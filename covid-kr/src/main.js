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

                    // Second Table 
                    const secondIndex = await getTableIndex($
                        , new RegExp(/region(.*)sub(.*)total(.*)epidemiological(.*)links(.*)others(.*)newly(.*)confirmed/g));
                    if (typeof secondIndex === "number") {
                        const secondTbody = $('#content_detail div.tb_contents tbody').eq(secondIndex);
                        // infected, infectedByRegion
                        secondTable = await extractSecondTableData(secondTbody, $);
                    }
                    const { infected, newlyConfirmd, infectedByRegion } = secondTable;

                    // Third Table
                    const thirdIndex = await getTableIndex($
                        , new RegExp(/confirmed(.*)deaths(.*)fatality(.*)/g));
                    if (typeof thirdIndex === "number") {
                        const thirdTbody = $('#content_detail div.tb_contents tbody').eq(thirdIndex);
                        thirdTable = await extractThirdTableData(thirdTbody, $);
                    }
                    const { deaths, infectedByAgeGroup } = thirdTable;

                    // ADD: infected, newlyConfirmd
                    if (infected) data.infected = infected;
                    if (newlyConfirmd) data.newlyConfirmd = newlyConfirmd;

                    // ADD: discharged, isolated, deaths, beingTested, testedNegative
                    Object.keys(firstTable).forEach(function (key) {
                        data[key] = firstTable[key];
                    });

                    // ADD: deaths,infectedByRegion, infectedByAgeGroup
                    if (!data.deaths && deaths) data.deaths = deaths;
                    if (infectedByRegion && infectedByRegion.length) data.infectedByRegion = infectedByRegion;
                    if (infectedByAgeGroup && infectedByAgeGroup.length) data.infectedByAgeGroup = infectedByAgeGroup;

                    // Source Date
                    const $sourceDate = $('ul[class="head info"] li:nth-child(1) b').text().trim();
                    const sourceDate = new Date($sourceDate)

                    //ADD: sourceUrl, lastUpdatedAtSource, lastUpdatedAtApify, readMe
                    data.sourceUrl = request.url;
                    data.lastUpdatedAtApify = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes())).toISOString();
                    data.lastUpdatedAtSource = new Date(Date.UTC(sourceDate.getFullYear(), sourceDate.getMonth(), sourceDate.getDate(), sourceDate.getHours(), sourceDate.getMinutes())).toISOString();
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

function isTimeToCheckCases() {
    return now.getHours() == '1' && now.getMinutes() < 5;
}

function customDate() {
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString()
}


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
    const fields = ['discharged', 'isolated', 'deaths', 'beingTested', 'testedNegative'];
    const result = {}
    fields.forEach((field, i) => {
        const value = $($tds).eq(i + 3).text().replaceAll();
        if (value) result[field] = value;
    });
    return result;
}
async function extractSecondTableData(tbody, $) {

    let infected = undefined;
    let newlyConfirmd = undefined;
    const infectedByRegion = [];

    $(tbody).find('tr').toArray().forEach((tr, i) => {
        const { length } = $(tr).find('td');
        if (length === 8) {
            const key = $(tr).find('td').first().text().replaceAll()
            const value = $(tr).find('td').first().next().text().replaceAll()
            const newly = $(tr).find('td').last().text().replaceAll()
            if (key.toLowerCase().includes('total')) {
                infected = value;
                newlyConfirmd = newly;
                return;
            }
            infectedByRegion.push({
                value,
                region: key,
                newlyConfirmd: newly
            })
        }
    })
    return { infected, newlyConfirmd, infectedByRegion }
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
                infected: $(tds).eq(1).text().replaceAll(),
                deaths: $(tds).eq(3).text().replaceAll(),
            })
        }
    });
    return { deaths, infectedByAgeGroup };
}
