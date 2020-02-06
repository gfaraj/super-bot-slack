const Botkit = require('botkit');
const config = require('config');
const axios = require('axios');
const fs = require("fs");
const mime = require('mime-types')
const express = require('express');

require('dotenv').config();

const options = config.get('SlackClient');

const controller = Botkit.slackbot({
    debug: false,
    clientSigningSecret: process.env.CLIENT_SIGNING_SECRET
});
const bot = controller.spawn({
    token: process.env.BOT_TOKEN
});

function startRTM() {
    console.log(`Starting RTM connection...`);

    bot.startRTM(function (err) {
        if (err) {
            console.log(`Failed to start RTM, error = ${err}`);
            console.log(`Retrying in 6 seconds...`);
            setTimeout(startRTM, 6000);
        }
        else {
            console.log(`RTM connection started.`);
        }
    })
}
startRTM();

controller.on('rtm_close', () => {
    startRTM();
});

const callbackRoute = '/api/message';
const callbackPort = process.env.CALLBACK_PORT || 3002;
const callbackHost = process.env.CALLBACK_HOST || 'localhost';
const callbackUrl = `http://${callbackHost}:${callbackPort}${callbackRoute}`;

function startCallbackServer() {
    const server = express();
    server.use(express.json({ limit: '20mb' }));

    server.post(callbackRoute, async (req, res) => {
        try {
            console.log(`Bot Sent: ${inspectMessage(req.body)}`);

            await onBotMessageReceived(req.body);
        }
        catch (error) {
            console.log(error);
        }
    });

    server.listen(callbackPort, () => {
        console.log(`Listening on ${callbackUrl}...`);
    });
}

startCallbackServer();

const slackRequestAdapter = axios.create({
   headers: {
       Authorization: `Bearer ${process.env.BOT_TOKEN}`
   }
});

function parse(str) {
    let pos = str.indexOf(' ');
    return (pos === -1) ? [str, ''] : [str.substr(0, pos), str.substr(pos + 1)];
};

function join(str1, str2, delim) {
    if (str1.length == 0) {
        return str2;
    }
    else if (str2.length == 0) {
        return str1;
    }
    else {
        return str1 + delim + str2;
    }
}

function inspectMessage(msg) {
    return JSON.stringify(msg, function (key, value) {
        if (key === 'data' && typeof value === 'string' && value.length > 50) {
            return value.substring(0, 50) + '[...]';
        }
        return value;
    });
}

function qualifyText(message, text) {
    return text
        .replace('$user', message.sender.id)
        .replace('$quoteUser', message.quotedMsg && message.quotedMsg.senderId)
        .replace('$chatId', message.chat.id);
}

async function slackFileToBotAttachment(file) {
    let response = await slackRequestAdapter.get(file.url_private_download, {
        responseType: 'arraybuffer'
    });
    let data = Buffer.from(response.data, 'binary').toString('base64');
    return {
        data: `data:${file.mimetype};base64,${data}`,
        mimetype: file.mimetype,
        filetype: file.filetype
    }
}

async function slackAttachmentToBotAttachment(attachment) {
    let mimetype = attachment.is_animated ? 'image/gif' : 'image/jpg';
    let filetype = attachment.is_animated ? 'gif' : 'jpg';
    let response = await axios.get(attachment.image_url, {
        responseType: 'arraybuffer'
    });
    let data = Buffer.from(response.data, 'binary').toString('base64');
    return {
        data: `data:${mimetype};base64,${data}`,
        mimetype,
        filetype,
        title: attachment.title
    }
}

async function slackAttachmentsToBotAttachment(attachments) {
    for (let attachment of attachments) {
        if (attachment.image_url) {
            return await slackAttachmentToBotAttachment(attachment);
        }
    }
    return null;
}

async function createBotMessage(message) {
    let parsedText = parse(message.text);
    
    let first = parsedText[0].trim();
    let rest = qualifyText(message, parsedText[1]);
    let attachment = null;
    let sender = { id : message.sender.id, name : message.sender.name, shortName : message.sender.shortName, isMe : message.sender.isMe };
    let chat = { id : message.chat.id };
    
    let hasTrigger = options.triggers.includes(first.substr(0, 1));
    let isDirected = false;
    if (!hasTrigger) {
        isDirected = first.substr(-1) == ":" && options.aliases.includes(first.substr(0, first.length - 1));
        if (!isDirected) {
            return null;
        }
    }

    if (message.files && message.files.length > 0) {
        attachment = await slackFileToBotAttachment(message.files[0]);
    }
    else if (message.attachments && message.attachments.length > 0) {
        attachment = await slackAttachmentsToBotAttachment(message.attachments);
    }
    else if (message.parent) {
        rest = join(rest, message.parent.text, ' ');
        if (message.parent.files && message.parent.files.length > 0) {
            attachment = await slackFileToBotAttachment(message.parent.files[0]);
        }
        else if (message.parent.attachments) {
            attachment = await slackAttachmentsToBotAttachment(message.parent.attachments);
        }
    }

    if (first.length > 0) {
        if (hasTrigger) {
            return { text : join(first.substr(1), rest, ' '), sender, chat, attachment };
        }
        else if (isDirected) {
            return { text : join('natural', rest, ' '), sender, chat, attachment };
        }
    }

    return null;
}

async function sendTextMessage(channel, text, source) {
    let message = {
        channel,
        text,
    };

    if (source && source.thread_ts) {
        bot.replyInThread(source.originalMessage, message);
    }
    else {
        bot.say(message);
    }
}

let uniqueFileId = 0;

async function saveFileToDisk(file) {
    return new Promise((resolve, reject) => {
        const data = file.data.split(',')[1];
        const fileExtension = file.filetype || mime.extension(file.mimetype) || file.fileType || mime.extension(file.mimeType) || 'txt';
        const fileName = require("path").join(
            process.cwd(), 
            `./temp/slack-work-${uniqueFileId++}.${fileExtension}`
        );
        
        if (!require("fs").existsSync('./temp')){
            require("fs").mkdirSync('./temp');
        }

        if (uniqueFileId > 10000) {
            uniqueFileId = 0;
        }
        require("fs").writeFile(fileName, data, 'base64', function(err) {
            if (err) {
                reject(err);
            }
            else {
                resolve(fileName);
            }
          });
    });
}

async function uploadFileAndPost(channel, file, text, source) {
    let fileName = await saveFileToDisk(file);

    return new Promise((resolve, reject) => {
        let options = {
            token: process.env.BOT_TOKEN,
            filename: `file.${file.filetype || mime.extension(file.mimetype)}`,
            filetype: "auto",
            channels: channel,
            file: fs.createReadStream(fileName)
        };
        if (text || file.title) {
            options.initial_comment = join(text, file.title, ' ');
        }
        if (source && source.thread_ts) {
            options.thread_ts = source.thread_ts;
        }

        bot.api.files.upload(options, (err, response) => {
            require("fs").unlink(fileName, (err) => {});
            if (err) {
                reject(err);
            }
            else {
                resolve(response.file);
            }
        });
    });
}



async function sendFile(channel, file, text, source) {
    //let fileSpec = await uploadFile(file);

    await uploadFileAndPost(channel, file, text, source);
    /*bot.say({
        channel,
        text,
        attachments: [
            {
                contentType: fileSpec.mimetype,
                contentUrl: fileSpec.url_private_download,
                name: `file.${fileSpec.filetype}`
            }
        ]
    });*/
}

function retrieveParentMessage(message) {
    return new Promise((resolve, reject) => {
        bot.api.conversations.history({
            token: process.env.USER_TOKEN,
            channel: message.channel,
            latest: message.thread_ts,
            limit: 1,
            inclusive: true
        }, (err, response) => {
            if (err) {
                console.log(err);
                resolve(null);
            }
            else {
                resolve(response.messages[0]);
            }
        });
    });
}

function retrieveUserName(user) {
    return new Promise((resolve, reject) => {
        bot.api.users.info({
            token: process.env.USER_TOKEN,
            user
        }, (err, response) => {
            if (err) {
                console.log(err);
                resolve(null);
            }
            else {
                resolve(response.user.name);
            }
        });
    });
}

async function onBotMessageReceived(message, source) {
    let text = message.text || '';
    if (message.error) {
        text = "Error: " + text;
    }                    
    if (message.attachment) {                        
        if (message.addressee) {
            text = `${message.addressee}: ` + text + '☝☝';
        }
        await sendFile(message.chat.id, message.attachment, text, source);
    }
    else {
        if (message.addressee) {
            text = `${message.addressee}: ` + text;
        }
        await sendTextMessage(message.chat.id, text, source);
    }
}

async function onMessageReceived(bot, message) {
    console.log(`Message from ${message.sender.id}: ${message.text}`);
    
    try {
        let botMessage = await createBotMessage(message);
        if (botMessage) {
            botMessage.callbackUrl = callbackUrl;

            console.log(`Sending to bot: ${inspectMessage(botMessage)}`);
            let response = await axios.post(process.env.SUPERBOT_URL, botMessage);
            
            if (response.status == 200) {
                console.log(`Received back: ${inspectMessage(response.data)}`);
                let data = response.data;
                if (!data.chat || !data.chat.id) {
                    data.chat = { id: message.chat.id };
                }

                await onBotMessageReceived(data, message);
            }
            else {
                console.log(`Could not contact bot.`);
                await sendTextMessage(message.chat.id, 'Error: could not contact bot.', message);
            }
        }
    }
    catch(error) {
        console.log(`Error when contacting bot: ${error}`, error.stack);
        await sendTextMessage(message.chat.id, 'Error: could not contact bot.', message);
    }
}

controller.on(['direct_message', 'ambient'], async function (bot, message) {
    console.log(`Received: ${inspectMessage(message)}`);
    
    try {
        let userName = await retrieveUserName(message.user);

        await onMessageReceived(bot, {
            originalMessage: message,
            sender : {
                id: message.user,
                userId: message.user,
                name: userName || message.user,
                isMe: false
            },
            chat: {
                id: message.channel,
                chatId: message.channel
            },
            type: message.type,
            text: message.text,
            thread_ts: message.thread_ts,
            attachments: message.attachments,
            files: message.files,
            parent: message.thread_ts && message.thread_ts != message.ts ? await retrieveParentMessage(message) : undefined
        });
    }
    catch(error) {
        console.log(`Error when parsing slack message: ${error}`, error.stack);
        await sendTextMessage(message.channel, 'Error: could not parse Slack message.', message);
    }
});
