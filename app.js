const express = require("express");
const puppeteer = require('puppeteer');
const { exec } = require("child_process");

// get env
require('dotenv').config();

const app = express();

app.use(express.json())
app.use(express.urlencoded({ extended: true }));


const PORT = 8081;

const USPS_USR = process.env.USPS_USR
const USPS_PW = process.env.USPS_PW

if (USPS_USR === null || USPS_USR === undefined || USPS_PW === null || USPS_PW === undefined) {
    throw "No valid USPS_USR and USPS_PW";
}

let MailBoxCache = {};

const MAIL_COUNT_REGEX = /[\w]+\(([\d]+)\)/;

const availableCommands = {
    'help:command': { 0: '' },
    'utility:logout': 'shutdown /l',
    'utility:lock': 'shutdown /l',
    'utility:mailbox': 'mailbox',
    'system:status': 'uptime'
}


function getAppropriateCommand(message) {
    let keys = Object.keys(message);
    let values = Object.values(message);

    if (keys.length !== 2 || values.length !== 2) {
        return null
    }

    let cmdPath = `${message['command']}:${message['modifier']}`;

    return availableCommands[cmdPath];
}

function sendErrorResponse(res, cmdType, message) {
    res.send({ 'type': cmdType, 'message': message, 'status': false });
}

function sendSuccessResponse(res, cmdType, message) {
    res.send({ 'type': cmdType, 'message': message, 'status': true });
}

function checkMailBoxAndRespond(res) {
    let today = new Date().toISOString().slice(0, 10);

    if (MailBoxCache[today]) {
        console.log("MailBox data exist: %j", today, JSON.stringify(MailBoxCache));
        parseAndRespond(res, today, MailBoxCache)
    } else {
        if (USPS_USR && USPS_PW) {
            (async () => {
                try {
                    const browser = await puppeteer.launch({
                        headless: false,
                        executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
                    });
                    const page = await browser.newPage();
                    await page.goto('https://reg.usps.com/entreg/LoginAction_input?app=Phoenix&appURL=https://www.usps.com/');
                    await page.type('#username', USPS_USR);
                    await page.type('#password', USPS_PW);
                    await page.click('#btn-submit');
                    await page.waitForNavigation();
                    await page.goto('https://informeddelivery.usps.com/box/pages/secure/DashboardAction_input.action?restart=1')

                    let text = await page.evaluate(() => Array.from(document.querySelectorAll('#cp_week li'), element => element.textContent));
                    text = text.map((value) => String(value.trim()));
                    await browser.close();

                    MailBoxCache[today] = text;

                    parseAndRespond(res, today, MailBoxCache);
                } catch (ex) {
                    console.log(ex);
                    sendErrorResponse(res, 'mailbox', 'Error while fetching data from USPS');
                }
            })();
        } else {
            console.log("Environment variables `USPS_USR` and/or `USPS_PW` are not properly set.");
            sendErrorResponse(res, 'mailbox', 'Something is not right');
        }
    }
}

function parseAndRespond(res, key, map) {
    let mailsToday = map[key].filter((itm) => itm.startsWith("Today"));
    let text = 'Nothing.';

    if (mailsToday) {
        var match = MAIL_COUNT_REGEX.exec(mailsToday);

        if (match) {
            if (match[1] === 0) {
                text = "No Mails";
            } else if (match[1] === 1) {
                text = "You have 1 mail";
            } else if (match[1] > 1) {
                text = `You have ${match[1]} mails`;
            }
            sendSuccessResponse(res, 'mailbox', text)
        } else {
            console.log(`Mails count match failed. ${mailsToday}`);
            sendErrorResponse(res, 'mailbox', text);
        }
    } else {
        console.log("Mails today is null");
        sendErrorResponse(res, 'mailbox', text);
    }
}


function executeAndRespond(cmd, res) {
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            sendErrorResponse(res, cmd, `${error}`);
        } else if (stderr) {
            sendErrorResponse(res, cmd, `${stderr}`);
        } else {
            sendSuccessResponse(res, cmd, `${stdout.trim()}`);
        }
    });
}



/*
    express related things from here...
*/

app.post("/utilities_local", async (req, res) => {
    let message = req.body
    console.log("Got request at /utilities_local, message: %j", message);

    let cmd = getAppropriateCommand(message)
    if (!cmd) {
        res.send({ 'type': 'Unknown', 'message': 'Invalid command message', 'status': false });
    } else {
        if (cmd === 'mailbox') {
            checkMailBoxAndRespond(res);
        } else {
            executeAndRespond(cmd, res);
        }
    }
});


app.listen(PORT, () => {
    console.log(`Listening at http://0.0.0.0:${PORT}`);
});
