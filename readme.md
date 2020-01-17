# super-bot-slack

This is a Slack client for [super-bot](https://github.com/gfaraj/super-bot). It is built using [Botkit](https://www.npmjs.com/package/botkit) version 0.7.0. It's not using the latest version of Botkit (v4 at the time of this writing) because it doesn't support the RTM API, and this is needed if you can't expose a public endpoint for Slack to push new messages. Currently, the Slack client only supports text messages. This client supports attachments of any kind (images, files, etc.) and will also work with message threads.

## Installing the bot client

Clone this repository:

```
git clone https://github.com/gfaraj/super-bot-slack.git
```

and install its dependencies by running:

```
npm install
```

Make sure you have npm and Node 10 or newer installed.

## Starting the bot

You can run the Slack client with the following command:

```
npm run start
```

## Configuration

The client uses a JSON configuration file located in the ./config folder. See the [config](https://docs.npmjs.com/cli/config) package documentation for more information. You will also need to provide environment variables called clientSigningSecret, botToken, and userToken either through the command-line or by creating an .env file. See the included .env.example file.
