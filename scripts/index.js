
const fs = require('fs');
const path = require('path');
const EC = require('eight-colors');
const PCR = require('puppeteer-chromium-resolver');
const ConsoleGrid = require('console-grid');

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
        headless: false,
        devtools: true,
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

const generatePackages = async () => {

    await launchBrowser();
    const page = await browser.newPage();
    const url = 'https://www.npmjs.com/~cenfun';
    EC.logCyan(`open page ${url} ...`);
    await page.goto(url);

    EC.logCyan('getting packages ...');
    const packages = await page.evaluate(async () => {
        const wait = (ms) => {
            return new Promise((resolve) => {
                if (ms) {
                    setTimeout(resolve, ms);
                } else {
                    setImmediate(resolve);
                }
            });
        };

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

        return list.map((el) => {
            const a = el.querySelector('a');
            const p = el.querySelector('p');
            return {
                name: a.innerText,
                url: a.href,
                description: p && p.innerText
            };
        });
    });

    if (!packages) {
        EC.logRed('Invalid packages ');
        return;
    }

    await page.close();
    EC.logCyan('page closed');

    return packages;
};


const generatePackageInfo = async (item) => {

    await launchBrowser();
    const page = await browser.newPage();
    EC.logCyan(`open page ${item.url} ...`);
    await page.goto(item.url);

    EC.logCyan('getting package info ...');
    const info = await page.evaluate(() => {
        return window.__context__ && window.__context__.context;
    });

    await page.close();
    await delay(500);

    if (!info) {
        EC.logRed(`Failed to get info: ${item.name}`);
        return;
    }

    return info;
};

const getPackageInfo = async (item) => {
    const jsonPath = path.resolve(__dirname, `../.temp/${item.name}.json`);
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

const getMarkDownTable = function(d) {
    //console.log(d);
    const lines = [];

    const header = [''];
    d.columns.forEach((c, i) => {
        const cn = c.name || '';
        header.push(cn.padEnd(c.width, ' '));
    });
    lines.push(header.join('|'));

    const line = [''];
    d.columns.forEach((c) => {
        if (c.align === 'right') {
            line.push(`${''.padEnd(c.width - 1, '-')}:`);
        } else {
            line.push(''.padEnd(c.width, '-'));
        }

    });
    lines.push(line.join('|'));

    d.rows.forEach((r) => {
        const row = [''];
        d.columns.forEach((c, i) => {
            const s = `${r[i]}`;
            if (c.align === 'right') {
                row.push(s.padStart(c.width, ' '));
            } else {
                row.push(s.padEnd(c.width, ' '));
            }
        });
        lines.push(row.join('|'));
    });

    return lines.join('\r\n');
};

const generateReadme = (list) => {
    EC.logCyan('generating list ...');
    const projects = list.map((item, i) => {
        return [
            i + 1,
            `[${item.name}](https://github.com/cenfun/${item.name})`,
            `![npm](https://img.shields.io/npm/v/${item.name}) `,
            `![npm](https://img.shields.io/npm/dw/${item.name})`
        ];
    });

    const d = {
        columns: [{
            name: '',
            width: 2,
            align: 'right'
        }, {
            name: 'Name',
            width: 30
        }, {
            name: 'Version',
            width: 7
        }, {
            name: 'Downloads',
            width: 8
        }],
        rows: projects
    };


    let content = readFileContent(path.resolve(__dirname, 'template/README.md'));
    console.log(content);
    content = replace(content, {
        'placeholder-projects': getMarkDownTable(d)
    });

    writeFileContent(path.resolve(__dirname, '../README.md'), content);
};

const start = async () => {
    const jsonPath = path.resolve(__dirname, '../.temp/npm-packages.json');
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
        'lz-compress',
        'turbochart',
        'svg-to-symbol'
    ];
    //filter wci-
    const packages = info.packages.filter((it) => {
        if (it.name.startsWith('wci-')) {
            return false;
        }
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
        const ds = item.info.downloads.pop();
        return {
            name: item.name,
            description: item.description,
            downloads: ds.downloads,
            label: ds.label
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
    const consoleGrid = new ConsoleGrid();
    consoleGrid.render({
        option: {},
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
            name: 'downloads'
        }, {
            id: 'label',
            name: 'label'
        }],
        rows: rows
    });

    //downloads.length = 15;

    generateReadme(downloads);

};

start();
