
const fs = require('fs');
const path = require('path');
const EC = require('eight-colors');
const PCR = require('puppeteer-chromium-resolver');
const CG = require('console-grid');
const MG = require('markdown-grid');
const axios = require('axios');
const cheerio = require('cheerio');

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
    EC.logCyan('launching browser ...');
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
    EC.logCyan(`open page ${url} ...`);
    await page.goto(url);
    await delay(500);

    EC.logCyan('getting packages ...');
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
                await wait(1000);
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
    EC.logCyan('page closed');

    await closeBrowser();

    if (!info) {
        EC.logRed('Invalid packages ');
        return;
    }

    if (info.packages.length < info.total) {
        EC.logRed(`Found packages less than ${info.total}: ${info.packages.length}`);
        return;
    }

    return info.packages;
};


const generatePackageInfo = async (item) => {

    const svgUrl = `https://img.shields.io/npm/dw/${item.name}`;

    EC.logCyan(`loading info ${svgUrl} ...`);

    let failed;
    const res = await axios.get(svgUrl, {
        timeout: 10 * 1000
    }).catch(function(e) {
        EC.logRed(e);
        failed = true;
    });

    if (failed) {
        return;
    }

    const $ = cheerio.load(res.data, {
        xmlMode: true
    });

    const text = $('svg').find('text').last().text();
    if (!text) {
        EC.logRed(`Not found text: ${item.name}`);
        return;
    }
    const v = text.split('/').shift();
    //console.log(v);
    let unit = 1;
    if (v.endsWith('k')) {
        unit = 1000;
    } else if (v.endsWith('M')) {
        unit = 1000 * 1000;
    }
    const downloads = (parseFloat(v) || 0) * unit;

    console.log(item.name, downloads);

    return {
        downloads
    };
};

const getPackageInfo = async (item) => {
    const jsonPath = path.resolve(__dirname, `../.temp/packages/${item.name}.json`);
    let info = readJSON(jsonPath);
    if (!info || info.date !== date) {
        info = await generatePackageInfo(item);
        if (!info) {
            return;
        }
        info.date = date;
        writeFileContent(jsonPath, JSON.stringify(info, null, 4));
    }
    item.info = info;
    return item;
};

const generateReadme = (list) => {
    EC.logCyan('generating list ...');
    const projects = list.map((item, i) => {
        return [
            i + 1,
            `[${item.name}](https://github.com/cenfun/${item.name})`,
            `[![](https://img.shields.io/npm/v/${item.name}?label=)](https://www.npmjs.com/package/${item.name})`,
            `[![](https://img.shields.io/librariesio/github/cenfun/${item.name}?label=)](https://github.com/cenfun/${item.name}/network/dependencies)`,
            `[![](https://badgen.net/github/dependents-repo/cenfun/${item.name}?label=)](https://github.com/cenfun/${item.name}/network/dependents)`,
            `[![](https://badgen.net/npm/dw/${item.name}?label=)](https://www.npmjs.com/package/${item.name})`,
            `[![](https://badgen.net/npm/dt/${item.name}?label=)](https://www.npmjs.com/package/${item.name})`
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
            name: 'Dependencies',
            align: 'right'
        }, {
            name: 'Repos',
            align: 'right'
        }, {
            name: 'Downloads',
            align: 'right'
        }, {
            name: '',
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
        'turbogrid',
        'turbochart',
        'wc-icons',
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
