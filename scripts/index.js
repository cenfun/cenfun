
const fs = require('fs');
const path = require('path');
const EC = require('eight-colors');
const PCR = require('puppeteer-chromium-resolver');
const CG = require('console-grid');
const MG = require('markdown-grid');
const axios = require('axios');

const date = new Date().toLocaleDateString();

const hasOwn = function(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
};

const replace = function(str, obj, defaultValue) {
    str = `${str}`;
    if (!obj) {
        return str;
    }
    str = str.replace(/\{([^}{]+)\}/g, function(match, key) {
        if (!hasOwn(obj, key)) {
            if (typeof defaultValue !== 'undefined') {
                return defaultValue;
            }
            return match;
        }
        let val = obj[key];
        if (typeof val === 'function') {
            val = val(obj, key);
        }
        if (typeof val === 'undefined') {
            val = '';
        }
        return val;
    });
    return str;
};

const readFileContent = function(filePath) {
    let content = null;
    const isExists = fs.existsSync(filePath);
    if (isExists) {
        content = fs.readFileSync(filePath);
        if (Buffer.isBuffer(content)) {
            content = content.toString('utf8');
        }
    }
    return content;
};

const readJSON = function(filePath) {
    // do NOT use require, it has cache
    const content = readFileContent(filePath);
    let json = null;
    if (content) {
        json = JSON.parse(content);
    }
    return json;
};

const writeFileContent = function(filePath, content, force = true) {
    const isExists = fs.existsSync(filePath);
    if (force || isExists) {
        const p = path.dirname(filePath);
        if (!fs.existsSync(p)) {
            fs.mkdirSync(p, {
                recursive: true
            });
        }
        fs.writeFileSync(filePath, content);
        return true;
    }
    return false;
};

const delay = (ms) => {
    return new Promise((resolve) => {
        if (ms) {
            setTimeout(resolve, ms);
        } else {
            setImmediate(resolve);
        }
    });
};

let browser;
const launchBrowser = async () => {
    if (browser) {
        return browser;
    }
    EC.log('launching browser ...');
    const stats = await PCR({});
    browser = await stats.puppeteer.launch({
        //headless: false,
        //devtools: true,
        args: [
            '--no-sandbox',
            '--no-default-browser-check',
            '--disable-setuid-sandbox',
            '--disable-translate',
            '--disable-gpu',
            '--disable-infobars',
            '--disable-notifications',
            '--disable-save-password-bubble',
            '--start-maximized'
        ],
        ignoreDefaultArgs: [
            '--hide-scrollbars',
            '--enable-automation'
        ],
        executablePath: stats.executablePath
    }).catch(function(error) {
        EC.logRed(error);
    });
    return browser;
};

const closeBrowser = async () => {
    if (browser) {
        await browser.close();
    }
};

const generatePackages = async () => {

    await launchBrowser();
    const page = await browser.newPage();
    const url = 'https://www.npmjs.com/~cenfun';
    EC.log(`open page ${url} ...`);
    await page.goto(url);
    await delay(500);

    EC.log('getting packages ...');
    const info = await page.evaluate(async () => {
        const wait = (ms) => {
            return new Promise((resolve) => {
                if (ms) {
                    setTimeout(resolve, ms);
                } else {
                    setImmediate(resolve);
                }
            });
        };

        const context = window.__context__.context;

        const total = context.packages.total;

        const showMore = async () => {
            const showMoreButton = document.evaluate("//a[text()='show more packages']", document).iterateNext();
            if (showMoreButton) {
                console.log('show more ...');
                showMoreButton.click();
                await wait(2000);
                return showMore();
            }
        };

        await showMore();

        const list = Array.from(document.querySelectorAll('#tabpanel-packages ul li'));

        const packages = list.map((el) => {
            const a = el.querySelector('a');
            const p = el.querySelector('p');
            return {
                name: a.innerText,
                url: a.href,
                description: p && p.innerText
            };
        });

        return {
            total,
            packages
        };
    });

    await page.close();
    EC.log('page closed');

    await closeBrowser();

    if (!info) {
        EC.logRed('Invalid packages ');
        return;
    }

    EC.logGreen(`Found packages: ${info.packages.length}`);

    if (info.packages.length < info.total) {
        EC.logRed(`Found packages less than ${info.total}: ${info.packages.length}`);
        return;
    }

    return info.packages;
};


//https://github.com/npm/registry/blob/master/docs/download-counts.md
const generatePackageInfo = async (item) => {

    const url = `https://api.npmjs.org/downloads/point/last-month/${item.name}`;

    EC.log(`loading info ${url} ...`);

    let failed;
    const res = await axios.get(url, {
        timeout: 10 * 1000
    }).catch(function(e) {
        EC.logRed(e);
        failed = true;
    });

    if (failed || !res.data) {
        return;
    }

    return res.data;
};

const getPackageInfo = async (item) => {
    const jsonPath = path.resolve(__dirname, `../.temp/packages/${item.name}.json`);
    let info = readJSON(jsonPath);
    if (!info || info.date !== date) {
        info = await generatePackageInfo(item);
        if (!info) {
            EC.logRed(`not found info: ${item.name}`);
            return;
        }
        info.date = date;
        writeFileContent(jsonPath, JSON.stringify(info, null, 4));
    }
    item.info = info;
    return item;
};

const generateReadme = (list) => {
    EC.log('generating list ...');
    const projects = list.map((item, i) => {
        return [
            i + 1,
            `[${item.name}](https://github.com/cenfun/${item.name})`,
            `[![](https://img.shields.io/npm/v/${item.name}?label=)](https://www.npmjs.com/package/${item.name})`,
            `[![](https://badgen.net/github/dependents-repo/cenfun/${item.name}?label=)](https://github.com/cenfun/${item.name}/network/dependents)`,
            `[![](https://img.bayuguai.com/npm/downloads/${item.name})](https://www.npmjs.com/package/${item.name})`,
            `[![](https://img.bayuguai.com/npm/size/${item.name}?label=)](https://www.npmjs.com/package/${item.name})`,
            `[![](https://img.bayuguai.com/npm/dependencies/${item.name}?label=)](https://github.com/cenfun/${item.name}/network/dependencies)`
        ];
    });

    const d = {
        columns: [{
            name: '',
            align: 'center'
        }, {
            name: 'Name',
            align: 'left'
        }, {
            name: 'Version',
            align: 'left'
        }, {
            name: 'Repos',
            align: 'right'
        }, {
            name: 'Downloads',
            align: 'left'
        }, {
            name: 'Size',
            align: 'right'
        }, {
            name: 'Dependencies',
            align: 'right'
        }],
        rows: projects
    };


    let content = readFileContent(path.resolve(__dirname, 'template/README.md'));
    //console.log(content);
    content = replace(content, {
        'placeholder-projects': MG(d)
    });

    writeFileContent(path.resolve(__dirname, '../README.md'), content);

    EC.logGreen('saved README.md');
};

const start = async () => {
    const jsonPath = path.resolve(__dirname, '../.temp/packages.json');
    let info = readJSON(jsonPath);
    if (!info || info.date !== date) {
        const packages = await generatePackages();
        if (!packages) {
            return;
        }
        info = {
            date,
            length: packages.length,
            packages
        };
        writeFileContent(jsonPath, JSON.stringify(info, null, 4));
    }

    const excludes = [
        'turbochart',
        'playwright-report-grid'
    ];

    const packages = info.packages.filter((it) => {
        if (excludes.includes(it.name)) {
            return false;
        }
        return true;
    });

    for (const item of packages) {
        const res = await getPackageInfo(item);
        if (!res) {
            return;
        }
    }

    //console.log(packages);

    const downloads = packages.map((item) => {
        return {
            name: item.name,
            description: item.description,
            downloads: item.info.downloads
        };

    });

    downloads.sort((a, b) => {
        return b.downloads - a.downloads;
    });

    const rows = [];
    downloads.forEach((item, i) => {
        item.index = i + 1;
        rows.push(item);
    });
    CG({
        columns: [{
            id: 'index',
            name: 'No.',
            type: 'number',
            maxWidth: 5
        }, {
            id: 'name',
            name: 'Name'
        }, {
            id: 'downloads',
            name: 'downloads',
            align: 'right'
        }],
        rows: rows
    });

    //downloads.length = 15;

    generateReadme(downloads);

};

start();
